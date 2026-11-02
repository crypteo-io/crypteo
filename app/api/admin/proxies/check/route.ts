import { requireAdmin } from "@/lib/admin";
import { checkAllProxies } from "@/lib/proxy-health";
import { listProxies, proxyView } from "@/lib/proxy-settings";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/** Check every proxy now (the worker also does every few minutes) and return the list. */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { response } = await requireAdmin();
  if (response) return response;

  try {
    const scan = await checkAllProxies();
    return NextResponse.json({ scan, proxies: (await listProxies()).map(proxyView) });
  } catch (error) {
    console.error("[admin/proxies/check]", error);
    return NextResponse.json({ error: "Could not check the proxies" }, { status: 500 });
  }
}
