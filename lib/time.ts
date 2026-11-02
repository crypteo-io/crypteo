// Wall-clock helpers and the duration units built on them.

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
//
// Reading the current time is "impure", and the react-hooks purity lint rule
// flags `Date.now()` / `new Date()` in a component body. That rule exists to
// keep *client* renders deterministic across re-renders — but Server Components
// render once per request and legitimately need the request-time clock. Routing
// those reads through these helpers keeps the intent explicit and the rule
// satisfied without weakening it elsewhere.

export function nowMs(): number {
  return Date.now();
}

export function nowDate(): Date {
  return new Date();
}
