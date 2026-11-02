import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    merchant: { findUnique: vi.fn() },
    webhookLog: { create: vi.fn() },
    payment: { update: vi.fn() },
  },
}));
vi.mock("../security", () => ({
  isSafeWebhookUrl: vi.fn(),
  postWebhook: vi.fn(),
}));
vi.mock("../mailer", () => ({ sendEmail: vi.fn() }));

import { prisma } from "../db";
import { isSafeWebhookUrl, postWebhook } from "../security";
import {
  deliverWebhook,
  sendWebhookRequest,
  triggerNotifications,
  WEBHOOK_RESPONSE_MAX_CHARS,
  WEBHOOK_TIMEOUT_MS,
} from "./notify";

const merchantFindUnique = prisma.merchant
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const webhookLogCreate = prisma.webhookLog
  .create as unknown as ReturnType<typeof vi.fn>;
const paymentUpdate = prisma.payment
  .update as unknown as ReturnType<typeof vi.fn>;
const safe = isSafeWebhookUrl as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-07-24T12:00:00.000Z");
const MIN = 60_000;

function payment(o: Record<string, unknown> = {}) {
  return {
    id: "pay1",
    merchantId: "m1",
    externalId: "ext1",
    status: "confirmed",
    chain: "eth",
    token: "ETH",
    expectedAmount: 1,
    receivedAmount: 1,
    txHash: "0xabc",
    createdAt: NOW,
    updatedAt: NOW,
    webhookUrl: "https://merchant.example/hook",
    webhookAttempts: 0,
    nextWebhookRetryAt: null,
    ...o,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// postWebhook (lib/security.ts) is the SSRF-guarded transport; its own
// socket-level behaviour is covered in lib/security.test.ts.
function fetchResponse({
  ok = true,
  status = 200,
  body = "ok",
  location = null as string | null,
} = {}) {
  return { ok, status, text: body, location };
}

function mockFetch() {
  (postWebhook as unknown as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue(fetchResponse());
}

const fetchMock = () => postWebhook as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  merchantFindUnique.mockReset().mockResolvedValue({ isActive: true, webhookSecret: null });
  webhookLogCreate.mockReset().mockResolvedValue({});
  paymentUpdate.mockReset().mockResolvedValue({});
  safe.mockReset().mockResolvedValue(true);
  mockFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("deliverWebhook", () => {
  it("on success sets webhookSentAt, clears the retry marker, and logs success", async () => {
    await deliverWebhook(payment({ webhookAttempts: 0 }));

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(webhookLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attempt: 1,
          success: true,
          statusCode: 200,
        }),
      }),
    );
    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { webhookAttempts: 1, webhookSentAt: NOW, nextWebhookRetryAt: null },
    });
  });

  it("on an error response schedules the first retry (1 minute) and logs failure", async () => {
    fetchMock().mockResolvedValue(fetchResponse({ ok: false, status: 500 }));

    await deliverWebhook(payment({ webhookAttempts: 0 }));

    expect(webhookLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ success: false, statusCode: 500 }),
      }),
    );
    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        webhookAttempts: 1,
        nextWebhookRetryAt: new Date(NOW.getTime() + 1 * MIN),
      },
    });
  });

  it("on a network exception schedules a retry and logs the failure", async () => {
    fetchMock().mockRejectedValue(new Error("boom"));

    // attempt 3 → backoff index 2 → 15 minutes
    await deliverWebhook(payment({ webhookAttempts: 2 }));

    expect(webhookLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attempt: 3,
          success: false,
          statusCode: null,
          response: "boom",
        }),
      }),
    );
    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        webhookAttempts: 3,
        nextWebhookRetryAt: new Date(NOW.getTime() + 15 * MIN),
      },
    });
  });

  it("uses the final 6-hour backoff on the last scheduled retry", async () => {
    fetchMock().mockResolvedValue(fetchResponse({ ok: false, status: 500 }));

    // attempt 5 → backoff index 4 → 6 hours
    await deliverWebhook(payment({ webhookAttempts: 4 }));

    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        webhookAttempts: 5,
        nextWebhookRetryAt: new Date(NOW.getTime() + 6 * 60 * MIN),
      },
    });
  });

  it("abandons the webhook (clears the marker) once the backoff schedule is exhausted", async () => {
    fetchMock().mockResolvedValue(fetchResponse({ ok: false, status: 503 }));

    // attempt 6 → backoff index 5 is undefined → give up
    await deliverWebhook(payment({ webhookAttempts: 5 }));

    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { webhookAttempts: 6, nextWebhookRetryAt: null },
    });
  });

  it("signs the payload with the merchant webhook secret", async () => {
    merchantFindUnique.mockResolvedValue({ isActive: true, webhookSecret: "shhh" });

    await deliverWebhook(payment());

    const [, opts] = fetchMock().mock.calls[0];
    const expected = crypto
      .createHmac("sha256", "shhh")
      .update(opts.body)
      .digest("hex");
    expect(opts.headers["X-Signature"]).toBe(expected);
  });

  it("omits the signature header when the merchant has no secret", async () => {
    merchantFindUnique.mockResolvedValue({ isActive: true, webhookSecret: null });

    await deliverWebhook(payment());

    const [, opts] = fetchMock().mock.calls[0];
    expect(opts.headers["X-Signature"]).toBeUndefined();
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("sends an event named for the payment's current status", async () => {
    await deliverWebhook(payment({ status: "overpaid" }));

    const [, opts] = fetchMock().mock.calls[0];
    const parsed = JSON.parse(opts.body);
    expect(parsed.event).toBe("payment.overpaid");
    expect(parsed.payment.status).toBe("overpaid");
  });

  // An integration that fulfilled only "confirmed" left an overpaid order
  // (12.7 USDT for 12) pending; `paid` is the one field to act on.
  it.each([
    ["confirmed", true],
    ["overpaid", true],
    ["underpaid", false],
    ["expired", false],
  ])("marks a %s payment paid: %s", async (status, paid) => {
    await deliverWebhook(payment({ status }));
    const [, opts] = fetchMock().mock.calls[0];
    expect(JSON.parse(opts.body).payment.paid).toBe(paid);
  });

  it("clears a stale retry marker and skips delivery when the URL is unsafe", async () => {
    safe.mockResolvedValue(false);

    await deliverWebhook(payment({ nextWebhookRetryAt: NOW }));

    expect(fetchMock()).not.toHaveBeenCalled();
    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: { nextWebhookRetryAt: null },
    });
  });

  it("no-ops on an unsafe URL that had no pending retry", async () => {
    safe.mockResolvedValue(false);

    await deliverWebhook(payment({ nextWebhookRetryAt: null }));

    expect(fetchMock()).not.toHaveBeenCalled();
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  // Suspended or deleted accounts use nothing: their open checkouts are still
  // watched, but no webhook or email goes out for them.
  it("sends nothing for a suspended merchant and drops a queued retry", async () => {
    merchantFindUnique.mockResolvedValue({
      isActive: false,
      webhookSecret: null,
      webhookEndpoints: [{ id: "e", url: "https://a.example/h", isActive: true, isDefault: true }],
    });
    await deliverWebhook(payment({ webhookUrl: null, nextWebhookRetryAt: NOW }));
    expect(fetchMock()).not.toHaveBeenCalled();
    expect(paymentUpdate.mock.calls[0][0].data).toEqual({ nextWebhookRetryAt: null });
  });

  // One merchant can run several sites: each payment reaches exactly one of
  // them. Fanning every payment out to every endpoint made each site sift
  // through the others' events.
  describe("routing: exactly one destination per payment", () => {
    const A = { id: "ea", url: "https://site-a.example/hook", isActive: true, isDefault: true };
    const B = { id: "eb", url: "https://site-b.example/hook", isActive: true, isDefault: false };
    const withEndpoints = (...endpoints: (typeof A)[]) =>
      merchantFindUnique.mockResolvedValue({
        isActive: true,
        webhookSecret: null,
        webhookEndpoints: endpoints,
      });
    const sentTo = () => fetchMock().mock.calls.map((c) => c[0]);

    it("uses the payment's own URL first", async () => {
      withEndpoints(A, B);
      await deliverWebhook(payment({ webhookUrl: "https://own.example/h", webhookEndpointId: "eb" }));
      expect(sentTo()).toEqual(["https://own.example/h"]);
    });

    it("then the endpoint its API key or payment link named", async () => {
      withEndpoints(A, B);
      await deliverWebhook(payment({ webhookUrl: null, webhookEndpointId: "eb" }));
      expect(sentTo()).toEqual([B.url]);
    });

    it("otherwise only the default endpoint", async () => {
      withEndpoints(A, B);
      await deliverWebhook(payment({ webhookUrl: null, webhookEndpointId: null }));
      expect(sentTo()).toEqual([A.url]);
    });

    it("never re-routes a payment whose endpoint is paused or deleted", async () => {
      withEndpoints(A, { ...B, isActive: false });
      await deliverWebhook(payment({ webhookUrl: null, webhookEndpointId: "eb" }));
      withEndpoints(A);
      await deliverWebhook(payment({ webhookUrl: null, webhookEndpointId: "eb" }));
      expect(fetchMock()).not.toHaveBeenCalled();
    });

    it("sends nothing when the default is paused or there is none", async () => {
      withEndpoints({ ...A, isActive: false }, B);
      await deliverWebhook(payment({ webhookUrl: null, webhookEndpointId: null }));
      withEndpoints({ ...A, isDefault: false }, B);
      await deliverWebhook(payment({ webhookUrl: null, webhookEndpointId: null }));
      expect(fetchMock()).not.toHaveBeenCalled();
    });
  });

  it("no-ops (without even a safety check) when there is no webhook URL", async () => {
    await deliverWebhook(payment({ webhookUrl: null }));

    expect(safe).not.toHaveBeenCalled();
    expect(fetchMock()).not.toHaveBeenCalled();
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it("starts a fresh retry budget for a new status-change event", async () => {
    fetchMock().mockResolvedValue(fetchResponse({ ok: false, status: 500 }));

    // The previous event exhausted its schedule; a new event must still retry.
    await deliverWebhook(payment({ webhookAttempts: 6 }), { newEvent: true });

    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay1" },
      data: {
        webhookAttempts: 1,
        nextWebhookRetryAt: new Date(NOW.getTime() + 1 * MIN),
      },
    });
  });

  it("carries a stable event id in the payload and header", async () => {
    await deliverWebhook(payment({ status: "confirmed" }));
    await deliverWebhook(payment({ status: "confirmed", webhookAttempts: 3 }));

    const [[, first], [, second]] = fetchMock().mock.calls;
    expect(first.headers["X-Webhook-Id"]).toBe("pay1:confirmed:1");
    expect(JSON.parse(first.body).eventId).toBe("pay1:confirmed:1");
    expect(second.headers["X-Webhook-Id"]).toBe("pay1:confirmed:1");
  });

  it("gives a second underpaid top-up its own event id", async () => {
    await deliverWebhook(payment({ status: "underpaid", receivedAmount: 0.4 }));
    await deliverWebhook(payment({ status: "underpaid", receivedAmount: 0.7 }));

    const [[, first], [, second]] = fetchMock().mock.calls;
    expect(first.headers["X-Webhook-Id"]).toBe("pay1:underpaid:0.4");
    expect(second.headers["X-Webhook-Id"]).toBe("pay1:underpaid:0.7");
  });

  it("uses 0 for a status with nothing received", async () => {
    await deliverWebhook(payment({ status: "expired", receivedAmount: null }));
    const [[, first]] = fetchMock().mock.calls;
    expect(first.headers["X-Webhook-Id"]).toBe("pay1:expired:0");
  });
});

describe("triggerNotifications", () => {
  it("resets the webhook attempt counter for the new event", async () => {
    merchantFindUnique.mockResolvedValue({
      isActive: true,
      webhookSecret: null,
      email: "m@example.com",
      name: "M",
    });

    // "confirming" sends no email, isolating the webhook path.
    await triggerNotifications(
      payment({ status: "confirming", webhookAttempts: 6 }),
    );

    expect(webhookLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempt: 1 }),
      }),
    );
  });
});

describe("sendWebhookRequest", () => {
  const payload = {
    event: "payment.confirmed",
    eventId: "pay1:confirmed:1",
  } as unknown as Parameters<typeof sendWebhookRequest>[0]["payload"];

  it("delivers through the SSRF-guarded transport with a timeout", async () => {
    await sendWebhookRequest({ url: "https://m.example/h", payload, secret: null });

    const [url, opts] = fetchMock().mock.calls[0];
    expect(url).toBe("https://m.example/h");
    expect(opts.timeoutMs).toBe(WEBHOOK_TIMEOUT_MS);
  });

  it("treats a 3xx as a failed delivery without reading the body", async () => {
    const res = fetchResponse({
      ok: false,
      status: 302,
      body: "secret metadata",
      location: "http://169.254.169.254/latest/meta-data",
    });
    fetchMock().mockResolvedValue(res);

    const result = await sendWebhookRequest({
      url: "https://m.example/h",
      payload,
      secret: null,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(302);
    expect(result.response).toContain("Redirect not followed");
    expect(result.response).not.toContain("secret metadata");
    expect(result.response).toContain("169.254.169.254");
  });

  it("treats a 3xx as failed even if the response claims ok", async () => {
    fetchMock().mockResolvedValue(fetchResponse({ ok: true, status: 307 }));

    const result = await sendWebhookRequest({
      url: "https://m.example/h",
      payload,
      secret: null,
    });
    expect(result.success).toBe(false);
  });

  it("reports a timeout as a failed delivery instead of throwing", async () => {
    fetchMock().mockRejectedValue(
      new Error(`Webhook timed out after ${WEBHOOK_TIMEOUT_MS}ms`),
    );

    const result = await sendWebhookRequest({
      url: "https://m.example/h",
      payload,
      secret: null,
    });

    expect(result).toEqual({
      success: false,
      statusCode: null,
      response: `Webhook timed out after ${WEBHOOK_TIMEOUT_MS}ms`,
    });
  });

  it("truncates an oversized response body before it is stored", async () => {
    fetchMock().mockResolvedValue(fetchResponse({ body: "x".repeat(100_000) }));

    const result = await sendWebhookRequest({
      url: "https://m.example/h",
      payload,
      secret: null,
    });

    expect(result.success).toBe(true);
    expect(result.response!.length).toBeLessThan(WEBHOOK_RESPONSE_MAX_CHARS + 20);
    expect(result.response!.endsWith("[truncated]")).toBe(true);
  });

  it("signs the exact body it sends", async () => {
    await sendWebhookRequest({ url: "https://m.example/h", payload, secret: "k" });

    const [, opts] = fetchMock().mock.calls[0];
    expect(opts.headers["X-Signature"]).toBe(
      crypto.createHmac("sha256", "k").update(opts.body).digest("hex"),
    );
  });
});
