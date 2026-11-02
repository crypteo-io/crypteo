// Each merchant's billing month runs from their own anchor day to the same day
// of the next month (UTC midnight), anchored on the day the account was
// created, the way subscription services bill: one merchant's month ends on
// the 17th, another's on the 4th. An anchor past the end of a short month
// falls on its last day (31 → Feb 28/29 → Mar 31). Pure; safe for the client.

export interface Cycle {
  start: Date;
  end: Date;
}

/** The day of the month (1–31, UTC) a merchant's billing months start on. */
export function anchorDayOf(createdAt: Date): number {
  return createdAt.getUTCDate();
}

function daysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The cycle start in the given month (month may over/underflow). */
function cycleStartIn(year: number, month: number, anchorDay: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, daysInMonthUtc(y, m))));
}

/** The billing month that contains `at`. */
export function cycleContaining(anchorDay: number, at: Date): Cycle {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  let start = cycleStartIn(y, m, anchorDay);
  let startMonth = m;
  if (start.getTime() > at.getTime()) {
    startMonth = m - 1;
    start = cycleStartIn(y, startMonth, anchorDay);
  }
  return { start, end: cycleStartIn(y, startMonth + 1, anchorDay) };
}

/** The most recent billing month that has fully ended by `now`. */
export function lastCompletedCycle(anchorDay: number, now: Date): Cycle {
  const current = cycleContaining(anchorDay, now);
  return cycleContaining(anchorDay, new Date(current.start.getTime() - 1));
}

/**
 * Billing months from one cycle boundary to a later one of the same merchant.
 * Boundaries share an anchor day, so it is the calendar-month difference.
 */
export function monthsSpanned(start: Date, end: Date): number {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
}

const DAY = { month: "short", day: "numeric", timeZone: "UTC" } as const;
const DAY_YEAR = { ...DAY, year: "numeric" } as const;

/** "Mar 17 – Apr 17, 2026" (the end is the next cycle's first day). */
export function cycleLabel(start: Date | string, end: Date | string): string {
  const s = new Date(start);
  const e = new Date(end);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  return `${s.toLocaleDateString("en-US", sameYear ? DAY : DAY_YEAR)} – ${e.toLocaleDateString("en-US", DAY_YEAR)}`;
}

/** What an invoice covers: from its oldest carried month to its own month's end. */
export function invoicePeriodLabel(s: {
  accruingSince: Date | string | null;
  periodStart: Date | string;
  periodEnd: Date | string;
}): string {
  return cycleLabel(s.accruingSince ?? s.periodStart, s.periodEnd);
}

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}
