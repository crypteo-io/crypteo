import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { connection } from "next/server";
import PlaygroundClient from "./PlaygroundClient";

export const metadata: Metadata = pageMetadata({
  title: "Crypto Payments API Playground",
  description:
    "Try the Crypteo payments API in your browser: create a test session with a sandbox key, see the request and response, and walk through the hosted checkout.",
  path: "/playground",
});

/**
 * The shared sandbox key, or "" when none is configured.
 *
 * There is deliberately no hardcoded fallback: the old built-in key belonged
 * to a seed account and has been revoked, and a baked-in key can't be rotated
 * without a redeploy. Only a test-mode key is ever handed to this public page —
 * a live key set here by mistake would be published to every visitor.
 */
function sandboxKey(): string {
  const key = process.env.PLAYGROUND_PUBLIC_TEST_KEY?.trim() ?? "";
  return key.startsWith("test_") ? key : "";
}

export default async function PlaygroundPage() {
  // Read the env at request time, not at build time: otherwise the key (or
  // its absence) in the build environment would be frozen into static HTML,
  // and rotating or revoking it would need a rebuild.
  await connection();
  return <PlaygroundClient sandboxKey={sandboxKey()} />;
}
