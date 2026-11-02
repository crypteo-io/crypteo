import { requireAdmin } from "@/lib/admin";
import { renderPost } from "@/lib/blog/markdown";
import { MAX_CONTENT_LENGTH } from "@/lib/blog/post";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const previewSchema = z.object({
  content: z.string().max(MAX_CONTENT_LENGTH),
  format: z.enum(["html", "markdown"]).default("html"),
});

/** The editor's preview, rendered by the same sanitiser as the public page. */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { response } = await requireAdmin();
  if (response) return response;

  const parsed = previewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Content is too long or missing" }, { status: 400 });
  }
  return NextResponse.json({ html: renderPost(parsed.data) });
}
