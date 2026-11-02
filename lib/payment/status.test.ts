import { describe, expect, it } from "vitest";
import type { PaymentStatus } from "../chains/interface";
import { isPaidStatus } from "./status";

describe("isPaidStatus", () => {
  // Every status, so a new one can't be added without deciding this.
  const table: Record<PaymentStatus, boolean> = {
    pending: false,
    confirming: false,
    confirmed: true,
    overpaid: true,
    underpaid: false,
    expired: false,
    expired_received: false,
  };

  it.each(Object.entries(table))("%s → paid %s", (status, paid) => {
    expect(isPaidStatus(status)).toBe(paid);
  });
});
