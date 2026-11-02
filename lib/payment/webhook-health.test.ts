import { describe, expect, it } from "vitest";
import { summarizeDeliveries, type DeliveryRow } from "./webhook-health";

const A = "https://site-a.example/hook";
const B = "https://site-b.example/hook";
const row = (url: string, success: boolean, minute: number, statusCode = success ? 200 : 405): DeliveryRow => ({
  url,
  success,
  statusCode,
  createdAt: new Date(Date.UTC(2026, 9, 14, 15, minute)),
});

describe("summarizeDeliveries", () => {
  it("flags an endpoint that has never accepted a delivery", () => {
    const [a] = summarizeDeliveries([row(A, false, 1), row(A, false, 2)]);
    expect(a).toMatchObject({ url: A, attempts: 2, failures: 2, failing: true, lastStatusCode: 405 });
  });

  it("judges each endpoint on its latest delivery", () => {
    const health = summarizeDeliveries([
      row(A, true, 1),
      row(A, false, 5), // latest for A failed
      row(B, false, 2),
      row(B, true, 6), // latest for B succeeded
    ]);
    expect(health.find((h) => h.url === A)?.failing).toBe(true);
    expect(health.find((h) => h.url === B)?.failing).toBe(false);
  });

  it("marks which URLs are still delivery targets", () => {
    const [a, b] = summarizeDeliveries([row(A, false, 2), row(B, false, 1)], new Set([A]));
    expect(a).toMatchObject({ url: A, current: true });
    // B was replaced: its old failure must not keep warning the merchant.
    expect(b).toMatchObject({ url: B, current: false });
  });

  it("is empty with no deliveries", () => {
    expect(summarizeDeliveries([])).toEqual([]);
  });
});
