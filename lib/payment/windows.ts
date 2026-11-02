// Attribution windows past a session's expiresAt, in a module with no server
// imports so client components (the hosted checkout) can share the exact
// numbers the worker uses. lib/payment/match.ts re-exports them.

/**
 * A just-expired session may still claim a late deposit for this long. It must
 * comfortably exceed the pending-expiry cron cadence (workers/scheduler.ts) so
 * a session is polled while still inside the window; otherwise the grace path
 * (and the expired_received status) is never reachable.
 */
export const GRACE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes

/**
 * An underpaid session keeps accepting top-ups for this long past expiry; past
 * it the session is terminal, no longer polled or matched.
 */
export const TOPUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
