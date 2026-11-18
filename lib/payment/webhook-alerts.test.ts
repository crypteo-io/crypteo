import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  merchant: { findUnique: vi.fn() },
  webhookFailureNotice: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
}));
vi.mock("../db", () => ({ prisma: db }));
vi.mock("../mailer", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock("./webhook-health", () => ({ webhookHealth: vi.fn() }));

import { sendEmail } from "../mailer";
import { alertMerchantWebhooks, planWebhookAlerts, WEBHOOK_ALERT_REPEAT_MS, type NoticeRow } from "./webhook-alerts";
import { webhookHealth, type EndpointHealth } from "./webhook-health";

const NOW = new Date("2026-11-10T12:00:00Z");
const A = "https://shop-a.example/hook";
const B = "https://shop-b.example/hook";
const health = (url: string, failing: boolean, current = true): EndpointHealth => ({
  url,
  attempts: 4,
  failures: failing ? 4 : 0,
  failing,
  lastStatusCode: failing ? 405 : 200,
  lastAt: NOW.toISOString(),
  current,
});
const notice = (url: string, agoMs: number): NoticeRow => ({
  id: `n-${url}`,
  url,
  sentAt: new Date(NOW.getTime() - agoMs),
});

describe("planWebhookAlerts", () => {
  it("emails a URL the first time it fails", () => {
    const plan = planWebhookAlerts([health(A, true)], [], NOW);
    expect(plan.send.map((s) => s.health.url)).toEqual([A]);
  });

  it("doesn't repeat within a week, repeats after", () => {
    expect(planWebhookAlerts([health(A, true)], [notice(A, 60_000)], NOW).send).toEqual([]);
    const later = planWebhookAlerts([health(A, true)], [notice(A, WEBHOOK_ALERT_REPEAT_MS)], NOW);
    expect(later.send.map((s) => s.notice?.id)).toEqual([`n-${A}`]);
  });

  it("clears the notice of a URL that recovered or is no longer used", () => {
    const plan = planWebhookAlerts(
      [health(A, false), health(B, true, false)],
      [notice(A, 60_000), notice(B, 60_000)],
      NOW,
    );
    expect(plan.send).toEqual([]);
    expect(plan.clear.map((n) => n.url).sort()).toEqual([A, B]);
  });
});

describe("alertMerchantWebhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.merchant.findUnique.mockResolvedValue({ name: "Shop", email: "owner@shop.example", role: "merchant", isActive: true });
    db.webhookFailureNotice.findMany.mockResolvedValue([]);
    db.webhookFailureNotice.create.mockResolvedValue({});
    vi.mocked(webhookHealth).mockResolvedValue([health(A, true)]);
  });

  it("emails the merchant about their own failing URL", async () => {
    expect(await alertMerchantWebhooks("m1", NOW)).toBe(true);
    const mail = vi.mocked(sendEmail).mock.calls[0]?.[0];
    expect(mail?.to).toBe("owner@shop.example");
    expect(mail?.html).toContain(A);
  });

  it("never emails a suspended account", async () => {
    db.merchant.findUnique.mockResolvedValue({ name: "Shop", email: "x@y.z", role: "merchant", isActive: false });
    expect(await alertMerchantWebhooks("m1", NOW)).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing when another run claimed the notice", async () => {
    db.webhookFailureNotice.findMany.mockResolvedValue([notice(A, WEBHOOK_ALERT_REPEAT_MS + 1)]);
    db.webhookFailureNotice.updateMany.mockResolvedValue({ count: 0 });
    expect(await alertMerchantWebhooks("m1", NOW)).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("releases the claim when the mail fails", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false });
    db.webhookFailureNotice.deleteMany.mockResolvedValue({ count: 1 });
    expect(await alertMerchantWebhooks("m1", NOW)).toBe(false);
    expect(db.webhookFailureNotice.deleteMany).toHaveBeenCalledWith({
      where: { merchantId: "m1", url: A, sentAt: NOW },
    });
  });
});
