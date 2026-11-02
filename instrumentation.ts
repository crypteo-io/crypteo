export async function register() {
  // The app's chain and price reads use the proxies saved on admin Proxies
  // (the worker loads its own). Node runtime only: Prisma can't run on edge.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startProxySync } = await import("./lib/proxy-settings");
    await startProxySync();
  }
  // Only run in the Node.js runtime (not edge), and only in production
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production"
  ) {
    const { registerLifecycle } = await import("./lib/lifecycle");
    await registerLifecycle();
  }
}
