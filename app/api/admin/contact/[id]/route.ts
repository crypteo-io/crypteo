import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ handled: z.boolean() });

/** Mark a contact-form message handled (or back to new). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const { count } = await prisma.contactMessage.updateMany({
      where: { id },
      data: parsed.data.handled
        ? { handledAt: new Date(), handledBy: admin.email }
        : { handledAt: null, handledBy: null },
    });
    if (!count) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/contact/:id]", error);
    return NextResponse.json({ error: "Could not update the message" }, { status: 500 });
  }
}
