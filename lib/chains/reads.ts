import type { ReadCache } from "./interface";

/**
 * Memoise a chain read for the rest of one scheduler cycle.
 *
 * Every session on a shared wallet polls the same balance and the same
 * transfer list. Without sharing, N sessions cost N balance reads and N
 * transfer scans per cycle on free-tier endpoints (re-audit N4) — and N reads
 * a few hundred milliseconds apart can disagree, so pollers attributed against
 * different views of the wallet. One read per key per cycle fixes both.
 *
 * No cache (a one-off call, a test) means no memoisation. A failure is shared
 * too: every session of the cycle sees the same outage instead of each
 * retrying a refusing endpoint. Never used for balance SNAPSHOTS, which must be
 * read fresh — a stale snapshot turns an existing deposit into a payment.
 */
export function cachedRead<T>(
  reads: ReadCache | undefined,
  key: string,
  read: () => Promise<T>,
): Promise<T> {
  if (!reads) return read();
  let hit = reads.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = read();
    reads.set(key, hit);
  }
  return hit;
}

/** A fresh cache for one scheduler cycle. */
export function newReadCache(): ReadCache {
  return new Map();
}
