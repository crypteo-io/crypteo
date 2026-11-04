// Dismissing the failing-webhook notice. It hides the notice for a week, for
// the URLs failing at the time: a merchant whose orders depend on a broken
// endpoint can't silence it for good, and a new failing URL shows at once.

export const WEBHOOK_NOTICE_KEY = "webhook-notice-dismissed";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

export function dismissalValue(urls: readonly string[], now: number): string {
  return JSON.stringify({ urls, until: now + DISMISS_MS });
}

/** Whether a stored dismissal still covers every failing URL. Anything unreadable covers nothing. */
export function isDismissed(stored: string | null, urls: readonly string[], now: number): boolean {
  if (!stored) return false;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return false;
    const { urls: covered, until } = parsed as { urls?: unknown; until?: unknown };
    if (!Array.isArray(covered) || typeof until !== "number" || until <= now) return false;
    return urls.every((url) => covered.includes(url));
  } catch {
    return false;
  }
}
