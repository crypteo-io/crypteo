import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NOTIFICATIONS_PAGE } from "@/lib/notifications";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// The bell shows at most this many unread; past it, "99+".
const UNREAD_COUNT_CAP = 100;

/** The signed-in account's newest notifications and its unread count. */
export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const merchantId = session.user.id;

  try {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { merchantId },
        orderBy: { createdAt: "desc" },
        take: NOTIFICATIONS_PAGE,
        select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true },
      }),
      prisma.notification
        .findMany({
          where: { merchantId, readAt: null },
          select: { id: true },
          take: UNREAD_COUNT_CAP,
        })
        .then((rows) => rows.length),
    ]);
    return NextResponse.json({ items, unread, unreadCapped: unread >= UNREAD_COUNT_CAP });
  } catch (error) {
    console.error("[notifications] list failed:", error);
    return NextResponse.json({ error: "Could not load notifications" }, { status: 500 });
  }
}

const readSchema = z.union([
  z.object({ ids: z.array(z.string().regex(/^[a-z0-9]{20,40}$/)).min(1).max(100) }),
  z.object({ all: z.literal(true) }),
]);

/** Mark the account's own notifications read: some by id, or all. */
export async function PATCH(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = readSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const { count } = await prisma.notification.updateMany({
      where: {
        merchantId: session.user.id,
        readAt: null,
        ...("ids" in parsed.data ? { id: { in: parsed.data.ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ success: true, updated: count });
  } catch (error) {
    console.error("[notifications] mark read failed:", error);
    return NextResponse.json({ error: "Could not update notifications" }, { status: 500 });
  }
}
