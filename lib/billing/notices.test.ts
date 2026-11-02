import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../mailer", () => ({ sendEmail: vi.fn() }));

import { dueNotice, type NoticeState } from "./notices";

const HOUR = 60 * 60 * 1000;
const due = new Date("2026-11-20T12:00:00Z");
const at = (hoursBeforeDue: number) => new Date(due.getTime() - hoursBeforeDue * HOUR);
const none: NoticeState = {
  dueAt: due,
  noticeIssuedAt: null,
  notice72hAt: null,
  notice24hAt: null,
  noticeHoldAt: null,
};

describe("dueNotice", () => {
  it("sends the invoice, then 72h and 24h reminders, then the hold", () => {
    expect(dueNotice(none, at(7 * 24))).toBe("issued");
    const issued = { ...none, noticeIssuedAt: at(7 * 24) };
    expect(dueNotice(issued, at(100))).toBeNull();
    expect(dueNotice(issued, at(72))).toBe("72h");
    const r72 = { ...issued, notice72hAt: at(72) };
    expect(dueNotice(r72, at(30))).toBeNull();
    expect(dueNotice(r72, at(24))).toBe("24h");
    const r24 = { ...r72, notice24hAt: at(24) };
    expect(dueNotice(r24, at(1))).toBeNull();
    expect(dueNotice(r24, at(0))).toBe("hold");
    expect(dueNotice({ ...r24, noticeHoldAt: at(0) }, at(-5))).toBeNull();
  });

  it("sends only the latest window after an outage, never an earlier one", () => {
    // Worker down from issue until 10h before due: one 24h reminder, no 72h.
    expect(dueNotice(none, at(10))).toBe("24h");
    expect(dueNotice({ ...none, notice24hAt: at(10) }, at(5))).toBeNull();
    // Down past the due date: straight to the hold.
    expect(dueNotice(none, at(-2))).toBe("hold");
  });

  it("does nothing for a statement without a due date", () => {
    expect(dueNotice({ ...none, dueAt: null }, at(0))).toBeNull();
  });
});
