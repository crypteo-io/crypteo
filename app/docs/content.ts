import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle,
  FileCode,
  Key,
  Link2,
  ListChecks,
  Network,
  RefreshCw,
  Rocket,
  Send,
  ShieldCheck,
  Terminal,
  Webhook,
} from "lucide-react";

// The integration guide rendered by app/docs/page.tsx. Every field, status,
// limit and header here mirrors the code (app/api/public/v1/*,
// lib/payment/notify.ts, lib/payment/status.ts, lib/rate-limit.ts): change
// them together. Inline `code` in prose is rendered as <code>.

export interface DocExample {
  label: string;
  code: string;
}

export interface DocTable {
  title?: string;
  columns: string[];
  rows: string[][];
}

export interface DocSection {
  id: string;
  title: string;
  icon: LucideIcon;
  paragraphs: string[];
  /** Short must-know points, shown as a callout. */
  notes?: string[];
  tables?: DocTable[];
  examples?: DocExample[];
}

const BASE = "https://crypteo.io/api/public/v1";

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "overview",
    title: "Overview",
    icon: FileCode,
    paragraphs: [
      "Crypteo is a self-custodial crypto payment gateway: buyers pay straight into your own wallets, and we watch the chain and tell your server when a payment completes. We never hold funds or keys.",
      "Every integration follows the same four steps. (1) Your server creates a payment with your API key and keeps its `id` next to your order. (2) You send the buyer to the returned `checkoutUrl`. (3) We notify your server with a signed webhook on every status change. You can also poll the payment. (4) You fulfil the order when the payment's `paid` field is `true`.",
      "All requests and responses are JSON over HTTPS. Amounts are numbers, timestamps are ISO 8601 UTC strings, and chain/token values are lowercase strings.",
    ],
    notes: [
      "Call the API only from your server. Your API key must never reach a browser or mobile app.",
      "Never fulfil an order because the buyer came back to your site. Only a webhook or an API read with `paid: true` proves payment.",
    ],
    examples: [
      {
        label: "Base URL",
        code: `${BASE}`,
      },
      {
        label: "Flow",
        code: `Your server                 Crypteo                 Buyer
    │  POST /payments  ───────────▶ │                            │
    │ ◀─────── { id, checkoutUrl }  │                            │
    │  redirect buyer to checkoutUrl ─────────────────────────▶ │
    │                               │ ◀──── pays on-chain ──────│
    │ ◀── POST webhook (signed) ─── │  payment.confirmed         │
    │  fulfil order when paid=true  │                            │`,
      },
    ],
  },
  {
    id: "auth",
    title: "Authentication",
    icon: Key,
    paragraphs: [
      "Create API keys in your dashboard under API Keys. Live keys start with `crypt_` and create real payments. Test keys start with `test_` and create sandbox payments that are never watched on-chain (see Test mode).",
      "Send the key in an `Authorization: Bearer` header or an `x-api-key` header. A missing, revoked or unknown key returns `401 {\"error\":\"Unauthorized\"}`. A key only sees payments of its own mode: a test key cannot read live payments, and a live key cannot read test ones.",
      "We store only a SHA-256 hash of each key, so a key is shown once when you create it. Keep it in an environment variable and rotate it from the dashboard if it leaks.",
    ],
    examples: [
      {
        label: "cURL",
        code: `curl "${BASE}/payments/PAYMENT_ID" \\
  -H "Authorization: Bearer $CRYPTEO_API_KEY"`,
      },
      {
        label: "Node.js",
        code: `// Node 18+ (global fetch). Reuse this helper for every call below.
const API = "${BASE}";

async function crypteo(path, { method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: \`Bearer \${process.env.CRYPTEO_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || \`HTTP \${res.status}\`);
    err.status = res.status;
    err.retryAfter = Number(res.headers.get("Retry-After")) || null;
    throw err;
  }
  return data;
}`,
      },
      {
        label: "Python",
        code: `import os
import requests

API = "${BASE}"
session = requests.Session()
session.headers.update({
    "Authorization": f"Bearer {os.environ['CRYPTEO_API_KEY']}",
    "Content-Type": "application/json",
})

def crypteo(method, path, body=None):
    res = session.request(method, API + path, json=body, timeout=30)
    data = res.json() if res.content else {}
    if not res.ok:
        raise RuntimeError(f"{res.status_code}: {data.get('error', res.reason)}")
    return data`,
      },
      {
        label: "PHP",
        code: `<?php
function crypteo(string $method, string $path, ?array $body = null): array {
    $ch = curl_init("${BASE}" . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer " . getenv("CRYPTEO_API_KEY"),
            "Content-Type: application/json",
        ],
        CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body),
    ]);
    $raw = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    $data = json_decode($raw ?: "{}", true) ?? [];
    if ($status >= 400) {
        throw new RuntimeException(($data["error"] ?? "HTTP $status"), $status);
    }
    return $data;
}`,
      },
    ],
  },
  {
    id: "create",
    title: "Create a payment",
    icon: Rocket,
    paragraphs: [
      "`POST /payments` opens a checkout session that expires one hour after creation. There are two kinds.",
      "Flexible (recommended): omit `chain` and `token`. `amount` is then a USD price, and the buyer picks a network from your active wallets at checkout. The token amount is priced when they pick.",
      "Fixed: pass `chain` and `token` together. `amount` is then in units of that token (`0.01` with `eth`/`eth` means 0.01 ETH), and the buyer pays on that network only.",
      "Set `externalId` to your own order ID: it comes back in every webhook and API read, so you can match events to orders without storing anything else. Webhooks for the payment go to the endpoint you chose for the API key that created it, or to your default endpoint (see Webhooks). Pass `webhookUrl` to send this one payment's webhooks somewhere else instead.",
      "Pass `successUrl` to bring the buyer back to your site: once the payment is paid, checkout shows a \"Return to the store\" button and sends them there after 5 seconds. `cancelUrl` is where the back button on the network step and the expired screen lead. Neither marks an order paid: a buyer can open your success page by hand, so fulfil on the `payment.confirmed` webhook (or a read with `paid: true`), never on the visit.",
    ],
    tables: [
      {
        title: "Request body",
        columns: ["Field", "Type", "Description"],
        rows: [
          ["amount", "number, required", "USD price (flexible) or token amount (fixed). Must be greater than 0. `expectedAmount` is accepted as an alias."],
          ["chain", "string", "Network for a fixed payment, e.g. `eth`, `sol`, `btc`. Requires `token`."],
          ["token", "string", "Token on that network, e.g. `usdc`, `usdt`, `eth`. Requires `chain`."],
          ["externalId", "string, ≤ 200 chars", "Your order or invoice ID, echoed back everywhere."],
          ["webhookUrl", "string (URL)", "Optional. Public http(s) server route that accepts POST. This payment's webhooks go here instead of to the API key's endpoint or your default endpoint."],
          ["successUrl", "string (URL)", "Optional. http(s) page on your site the buyer is sent to once paid, e.g. your order confirmation page."],
          ["cancelUrl", "string (URL)", "Optional. http(s) page the buyer returns to if they leave checkout or it expires, e.g. your cart."],
          ["customerEmail", "string (email)", "Buyer's email, shown to you in the dashboard."],
          ["metadata", "object", "Your own key/value data, stored with the payment."],
        ],
      },
      {
        title: "Response: payment",
        columns: ["Field", "Type", "Description"],
        rows: [
          ["id", "string", "Payment ID. Store it with your order."],
          ["checkoutUrl", "string", "Hosted checkout. Redirect the buyer here."],
          ["amount", "number", "USD (flexible) or token amount (fixed), as sent."],
          ["chain, token", "string | null", "Null for flexible payments until the buyer picks."],
          ["walletAddress", "string | null", "Receiving address (fixed payments only)."],
          ["xrpDestinationTag, solMemoString", "string | null", "Per-payment identifier the buyer attaches on XRP / Solana."],
          ["expiresAt", "string", "When the checkout closes (creation + 1 hour)."],
        ],
      },
    ],
    examples: [
      {
        label: "cURL",
        code: `curl -X POST "${BASE}/payments" \\
  -H "Authorization: Bearer $CRYPTEO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 25,
    "externalId": "order_1042",
    "customerEmail": "buyer@example.com",
    "webhookUrl": "https://api.your-shop.com/webhooks/crypteo",
    "successUrl": "https://your-shop.com/orders/1042/thanks",
    "cancelUrl": "https://your-shop.com/cart"
  }'`,
      },
      {
        label: "Node.js",
        code: `// Uses the crypteo() helper from Authentication.
app.post("/checkout", async (req, res) => {
  const order = await db.orders.create({ userId: req.user.id, usd: 25 });

  const { payment } = await crypteo("/payments", {
    method: "POST",
    body: {
      amount: order.usd,              // USD: the buyer picks the network
      externalId: String(order.id),
      customerEmail: req.user.email,
      webhookUrl: "https://api.your-shop.com/webhooks/crypteo",
      successUrl: \`https://your-shop.com/orders/\${order.id}/thanks\`,
      cancelUrl: "https://your-shop.com/cart",
    },
  });

  await db.orders.update(order.id, { paymentId: payment.id });
  res.redirect(303, payment.checkoutUrl);
});`,
      },
      {
        label: "Python",
        code: `# Uses the crypteo() helper from Authentication.
@app.post("/checkout")
def checkout():
    order = orders.create(user_id=current_user.id, usd=25)
    payment = crypteo("POST", "/payments", {
        "amount": order.usd,
        "externalId": str(order.id),
        "customerEmail": current_user.email,
        "webhookUrl": "https://api.your-shop.com/webhooks/crypteo",
        "successUrl": f"https://your-shop.com/orders/{order.id}/thanks",
        "cancelUrl": "https://your-shop.com/cart",
    })["payment"]
    orders.update(order.id, payment_id=payment["id"])
    return redirect(payment["checkoutUrl"], code=303)`,
      },
      {
        label: "PHP",
        code: `<?php
// Uses the crypteo() helper from Authentication.
$order = createOrder($userId, 25);
$payment = crypteo("POST", "/payments", [
    "amount" => 25,
    "externalId" => (string) $order["id"],
    "customerEmail" => $userEmail,
    "webhookUrl" => "https://api.your-shop.com/webhooks/crypteo",
    "successUrl" => "https://your-shop.com/orders/" . $order["id"] . "/thanks",
    "cancelUrl" => "https://your-shop.com/cart",
])["payment"];
saveOrderPaymentId($order["id"], $payment["id"]);
header("Location: " . $payment["checkoutUrl"], true, 303);`,
      },
      {
        label: "Response",
        code: `{
  "success": true,
  "payment": {
    "id": "cmv2let0k0088iuglbuwggt6o",
    "checkoutUrl": "https://crypteo.io/checkout/cmv2let0k0088iuglbuwggt6o",
    "walletAddress": null,
    "amount": 25,
    "chain": null,
    "token": null,
    "expiresAt": "2026-10-15T13:00:00.000Z",
    "xrpDestinationTag": null,
    "solMemoString": null
  }
}`,
      },
      {
        label: "Fixed (cURL)",
        code: `# 25 USDC on Ethereum: amount is in USDC, not USD
curl -X POST "${BASE}/payments" \\
  -H "Authorization: Bearer $CRYPTEO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "chain": "eth", "token": "usdc", "amount": 25, "externalId": "order_1043" }'`,
      },
    ],
  },
  {
    id: "status",
    title: "Get a payment",
    icon: CheckCircle,
    paragraphs: [
      "`GET /payments/{id}` returns the payment's current state. Use it to confirm a webhook before acting on it, or as a fallback if your webhook endpoint was down.",
      "`expectedAmount` and `receivedAmount` are in units of the payment's token once a network is chosen. For a flexible payment that hasn't been picked yet, `expectedAmount` is still the USD price and `availableWallets` lists the networks the buyer can choose, in your Wallets page order, each with its `asset` and `network` names. It stays filled while a pending buyer can still switch.",
      "If you poll instead of using webhooks, poll every 15–30 seconds while the payment is open. Stop as soon as it reaches a final status (see Payment statuses), and never poll a payment forever: a session lasts one hour, plus up to 24 hours for an underpaid top-up.",
    ],
    tables: [
      {
        title: "Response: payment",
        columns: ["Field", "Type", "Description"],
        rows: [
          ["id", "string", "Payment ID."],
          ["status", "string", "One of the statuses below."],
          ["paid", "boolean", "`true` when paid in full (`confirmed` or `overpaid`). Fulfil on this."],
          ["externalId", "string | null", "Your order ID from creation."],
          ["chain, token", "string | null", "Network and token, once chosen."],
          ["expectedAmount", "number", "Amount due, in token units once a network is chosen."],
          ["receivedAmount", "number | null", "Amount received on-chain, in token units."],
          ["txHash", "string | null", "On-chain transaction ID, when resolved."],
          ["walletAddress", "string | null", "Address the buyer was asked to pay."],
          ["amountDue, amountDueText", "number, string", "What the buyer has to send now, as a number and ready to show: the shortfall once a partial deposit has landed."],
          ["xrpDestinationTag, solMemoString", "string | null", "The tag or memo a buyer attaches on XRP or Solana."],
          ["paymentUri", "string", "What to encode in a QR code: a wallet payment link with the amount, or the bare address on XRP. Empty until a network is chosen."],
          ["expiresAt, createdAt, updatedAt", "string", "ISO 8601 timestamps."],
          ["isTest", "boolean", "Created with a test key."],
        ],
      },
    ],
    examples: [
      {
        label: "cURL",
        code: `curl "${BASE}/payments/cmv2let0k0088iuglbuwggt6o" \\
  -H "Authorization: Bearer $CRYPTEO_API_KEY"`,
      },
      {
        label: "Response",
        code: `{
  "success": true,
  "payment": {
    "id": "cmv2let0k0088iuglbuwggt6o",
    "status": "overpaid",
    "paid": true,
    "chain": "sol",
    "token": "usdt",
    "expectedAmount": 12,
    "receivedAmount": 12.7,
    "txHash": "2FWuN1y3jhTT2gJScv9sYH6GWggGrPHBkEcvm1Xs59j4…",
    "walletAddress": "ACTceHEAZYvx4kaukH5aByWo1ckf6Nh9R2iG27XSkN5D",
    "externalId": "order_1042",
    "createdAt": "2026-10-10T16:12:37.605Z",
    "updatedAt": "2026-10-10T16:16:33.548Z",
    "expiresAt": "2026-10-10T17:12:37.603Z",
    "isTest": false,
    "paymentLink": null
  },
  "availableWallets": []
}`,
      },
      {
        label: "Polling (Node.js)",
        code: `// Fallback only: prefer webhooks. Stops on a final status.
const FINAL = new Set(["confirmed", "overpaid", "expired", "expired_received"]);

async function waitForPayment(id, { intervalMs = 20_000, maxMs = 75 * 60_000 } = {}) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const { payment } = await crypteo(\`/payments/\${id}\`);
      if (payment.paid || FINAL.has(payment.status)) return payment;
    } catch (err) {
      if (err.status === 404 || err.status === 401) throw err; // won't fix itself
      // 429/5xx: back off and keep going
      await new Promise((r) => setTimeout(r, (err.retryAfter ?? 30) * 1000));
      continue;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null; // still open: check again later or rely on the webhook
}`,
      },
    ],
  },
  {
    id: "statuses",
    title: "Payment statuses",
    icon: ListChecks,
    paragraphs: [
      "Fulfil an order when `paid` is `true`. That covers both `confirmed` and `overpaid`: an overpayment is still a full payment. An integration that only checks for `confirmed` leaves overpaid orders unfulfilled.",
      "`underpaid` means only part of the amount arrived. The buyer can top up within 24 hours after the checkout expires; if the total reaches the amount, the payment moves to `confirmed` and you get a new event.",
      "`expired` and `expired_received` are final for automatic detection, so stop polling them. A late payment (`expired_received`) is not credited automatically, but our team may still credit an expired payment after review. That change reaches you as a normal webhook, so keep your handler able to move an expired order to paid.",
    ],
    tables: [
      {
        columns: ["status", "paid", "Meaning", "What to do"],
        rows: [
          ["pending", "false", "Waiting for the buyer to pay.", "Nothing yet."],
          ["confirming", "false", "Payment seen on-chain, waiting for confirmations.", "Show 'processing'. Don't fulfil yet."],
          ["confirmed", "true", "Paid in full and confirmed.", "Fulfil the order."],
          ["overpaid", "true", "Paid more than asked.", "Fulfil the order. Refund the difference if you choose."],
          ["underpaid", "false", "Part of the amount arrived.", "Wait for a top-up, or settle `receivedAmount` manually."],
          ["expired", "false", "Nothing arrived before expiry.", "Cancel or release the order."],
          ["expired_received", "false", "Funds arrived after expiry.", "Review: refund, or credit it yourself."],
        ],
      },
    ],
    examples: [
      {
        label: "Node.js",
        code: `function orderStateFor(payment) {
  if (payment.paid) return "paid";            // confirmed | overpaid
  switch (payment.status) {
    case "pending":
    case "confirming":
      return "awaiting_payment";
    case "underpaid":
      return "partially_paid";               // a top-up may still complete it
    case "expired":
      return "cancelled";
    case "expired_received":
      return "needs_review";                 // money arrived late
    default:
      return "awaiting_payment";             // unknown future status: don't fulfil
  }
}`,
      },
    ],
  },
  {
    id: "webhooks",
    title: "Webhooks",
    icon: Webhook,
    paragraphs: [
      "We POST a JSON event every time a payment's status changes, including `confirming`, `underpaid` top-ups, and expiry.",
      "Each payment is sent to exactly one URL, never to several. Add one endpoint per site in Settings → Webhooks (up to 10), and mark one as the default. The destination is, in order: (1) the payment's own `webhookUrl`, if you passed one when creating it through the API or set a custom URL on its payment link; (2) the endpoint chosen for the API key that created it, or for the payment link it came through; (3) otherwise your default endpoint. Running several sites on one account? Create one API key per site and point each key at that site's endpoint (API Keys page): every site then hears only about its own payments. A payment keeps the endpoint its key or link named when it was created, so changing a key's endpoint applies to the payments it creates afterwards. Payments on your default go to whichever endpoint is the default when each delivery is made.",
      "Each URL must be a server route that accepts POST and answers with any 2xx status within 10 seconds. A URL that your frontend or a static site serves answers `405 Not Allowed`, and every delivery fails. Use 'Send test' next to an endpoint in Settings to check it before a real payment depends on it. Redirects are not followed and count as failures, so use the final https URL.",
      "A failed delivery is retried after 1 minute, 5 minutes, 15 minutes, 1 hour and 6 hours. Each retry carries the payment's state at that moment and goes to the destination as it is then, so fixing an endpoint's URL also fixes its pending retries. A new status change starts a new event with its own retries. A paused endpoint receives nothing, and a payment routed to a paused or deleted endpoint is never sent to another endpoint instead. Settings and your dashboard show which endpoints are failing, and you can resend the latest event from the payment's page.",
    ],
    tables: [
      {
        title: "Where a payment's webhooks go (first match wins)",
        columns: ["Payment", "Destination"],
        rows: [
          ["Created with a `webhookUrl` (API), or through a link with a custom URL", "That URL"],
          ["Created with an API key that has an endpoint", "That endpoint"],
          ["Created through a payment link that has an endpoint", "That endpoint"],
          ["Anything else (no URL, key or link endpoint)", "Your default endpoint"],
          ["Its endpoint is paused or deleted", "Nowhere: it is never re-routed to another endpoint"],
        ],
      },
      {
        title: "Request headers",
        columns: ["Header", "Description"],
        rows: [
          ["Content-Type", "`application/json`"],
          ["X-Webhook-Id", "The event's `eventId`, for deduplication."],
          ["X-Signature", "Hex HMAC-SHA256 of the raw body, keyed with your signing secret (one secret for all of your endpoints). Sent only when a secret is set in Settings → Webhooks."],
        ],
      },
      {
        title: "Payload",
        columns: ["Field", "Type", "Description"],
        rows: [
          ["event", "string", "`payment.` + the new status, e.g. `payment.confirmed`. 'Send test' sends `webhook.test` with `payment: null`."],
          ["eventId", "string", "`{paymentId}:{status}:{receivedAmount}`. Identical across retries and resends; a new amount or status is a new id."],
          ["payment", "object", "`id`, `externalId`, `status`, `paid`, `chain`, `token`, `expectedAmount`, `receivedAmount`, `txHash`, `createdAt`, `updatedAt`."],
          ["timestamp", "string", "When this delivery was built."],
        ],
      },
    ],
    examples: [
      {
        label: "Payload",
        code: `{
  "event": "payment.confirmed",
  "eventId": "cmv2let0k0088iuglbuwggt6o:confirmed:25",
  "payment": {
    "id": "cmv2let0k0088iuglbuwggt6o",
    "externalId": "order_1042",
    "status": "confirmed",
    "paid": true,
    "chain": "eth",
    "token": "usdc",
    "expectedAmount": 25,
    "receivedAmount": 25,
    "txHash": "0x5f1c…9b",
    "createdAt": "2026-10-15T12:00:00.000Z",
    "updatedAt": "2026-10-15T12:04:10.000Z"
  },
  "timestamp": "2026-10-15T12:04:10.120Z"
}`,
      },
      {
        label: "Several sites",
        code: `# One account, two sites. In the dashboard:
#   Settings → Webhooks: add https://api.shop-a.com/webhooks/crypteo
#                        and https://api.shop-b.com/webhooks/crypteo
#   API Keys: create a key for each site and point it at that site's endpoint.
#
# Each site's server then uses its own key, and nothing else changes:

# shop A's server (.env)
CRYPTEO_API_KEY=crypt_…shopA     # → shop A's endpoint only

# shop B's server (.env)
CRYPTEO_API_KEY=crypt_…shopB     # → shop B's endpoint only

# Payment links: choose the selling site's endpoint on each link.`,
      },
      {
        label: "Test event",
        code: `{
  "event": "webhook.test",
  "eventId": "test:cmv9whe1:1792065600000",
  "payment": null,
  "timestamp": "2026-10-15T12:00:00.000Z"
}`,
      },
      {
        label: "Check your URL",
        code: `# Your webhook URL must accept POST. This should NOT return 404/405:
curl -i -X POST "https://api.your-shop.com/webhooks/crypteo" \\
  -H "Content-Type: application/json" -d '{}'
# Expect 401 (bad signature) from a correct handler: the route exists.`,
      },
    ],
  },
  {
    id: "verify",
    title: "Verify signatures",
    icon: ShieldCheck,
    paragraphs: [
      "Set a signing secret in Settings → Webhooks and verify every request. All of your endpoints are signed with the same secret. Anyone can POST to your URL, so a request without a valid signature must be rejected with 401 and must change nothing.",
      "Compute HMAC-SHA256 over the raw request body, exactly as received, using your secret, and compare its hex digest to the `X-Signature` header with a constant-time comparison. Hash the raw bytes, not a re-serialised JSON object: parsing and re-encoding changes the bytes and the signature never matches.",
    ],
    examples: [
      {
        label: "Node.js (Express)",
        code: `import crypto from "node:crypto";
import express from "express";

const app = express();

// express.raw keeps the exact bytes we signed. Register this route
// BEFORE any app.use(express.json()) so the body isn't parsed first.
app.post(
  "/webhooks/crypteo",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.get("X-Signature") ?? "";
    const expected = crypto
      .createHmac("sha256", process.env.CRYPTEO_WEBHOOK_SECRET)
      .update(req.body)
      .digest("hex");

    const valid =
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!valid) return res.status(401).send("invalid signature");

    const event = JSON.parse(req.body.toString("utf8"));
    await handleEvent(event);          // see "Handle events"
    res.sendStatus(200);
  },
);`,
      },
      {
        label: "Next.js (App Router)",
        code: `// app/api/webhooks/crypteo/route.ts
import crypto from "node:crypto";

export async function POST(req: Request) {
  const raw = await req.text();                     // raw body, unparsed
  const signature = req.headers.get("x-signature") ?? "";
  const expected = crypto
    .createHmac("sha256", process.env.CRYPTEO_WEBHOOK_SECRET!)
    .update(raw)
    .digest("hex");

  const valid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return new Response("invalid signature", { status: 401 });

  await handleEvent(JSON.parse(raw));
  return new Response(null, { status: 200 });
}`,
      },
      {
        label: "Python (Flask)",
        code: `import hashlib
import hmac
import json
import os

from flask import Flask, abort, request

app = Flask(__name__)
SECRET = os.environ["CRYPTEO_WEBHOOK_SECRET"].encode()

@app.post("/webhooks/crypteo")
def crypteo_webhook():
    raw = request.get_data()                        # raw bytes
    expected = hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
    signature = request.headers.get("X-Signature", "")
    if not hmac.compare_digest(expected, signature):
        abort(401)

    handle_event(json.loads(raw))
    return "", 200`,
      },
      {
        label: "PHP",
        code: `<?php
// webhooks/crypteo.php
$raw = file_get_contents("php://input");             // raw body
$signature = $_SERVER["HTTP_X_SIGNATURE"] ?? "";
$expected = hash_hmac("sha256", $raw, getenv("CRYPTEO_WEBHOOK_SECRET"));

if (!hash_equals($expected, $signature)) {
    http_response_code(401);
    exit("invalid signature");
}

$event = json_decode($raw, true);
handleEvent($event);
http_response_code(200);`,
      },
    ],
  },
  {
    id: "handle",
    title: "Handle events",
    icon: RefreshCw,
    paragraphs: [
      "Webhooks are delivered at least once: a retry or a manual resend can bring the same event again, and a slow response can make us retry an event you already processed. Record each `eventId` you handle and skip ones you've seen.",
      "Check `event` first: act on `payment.*` events and acknowledge anything else (such as `webhook.test`) with 2xx. If an event names an order you don't have (for example a payment you created from another system without a `webhookUrl`), acknowledge it and do nothing.",
      "Find the order by `payment.id` (stored at creation) or `payment.externalId`. Act on `payment.paid`, and never move an order backwards: once it's paid it stays paid, whatever a later or out-of-order event says. For high-value orders, re-read `GET /payments/{id}` and act on that response.",
      "Answer 2xx quickly. If fulfilment is slow (sending emails, provisioning), record the event, respond, and do the work in a background job, or the 10-second timeout fails the delivery and we retry it.",
    ],
    notes: [
      "Fulfil on `paid: true`, not only on `status === \"confirmed\"`: `overpaid` is paid too.",
      "Use a server route for every webhook URL, not a page of your website: a frontend route answers 405 and you never hear about payments. 'Send test' in Settings catches this at once.",
      "Respond 2xx even for events you ignore (e.g. `payment.confirming`), or they are retried.",
      "Compare amounts in the payment's token (`expectedAmount`/`receivedAmount`). Your USD price is what you sent at creation.",
    ],
    examples: [
      {
        label: "Node.js",
        code: `// Idempotent: safe to run twice for the same event.
async function handleEvent(event) {
  // 0. Only payment events carry a payment (Send test sends webhook.test).
  if (!event.event.startsWith("payment.")) return;
  const { eventId, payment } = event;

  // 1. Deduplicate (unique index on processed_events.event_id).
  const fresh = await db.processedEvents.insertIfAbsent(eventId);
  if (!fresh) return;

  // 2. Find the order.
  const order =
    (await db.orders.findByPaymentId(payment.id)) ??
    (await db.orders.findById(payment.externalId));
  if (!order) return;                       // another site's order: acknowledge and ignore

  // 3. Never go backwards once paid.
  if (order.status === "paid") return;

  if (payment.paid) {
    await db.orders.update(order.id, {
      status: "paid",
      txHash: payment.txHash,
      paidAmount: payment.receivedAmount,
      paidToken: payment.token,
    });
    await jobs.enqueue("fulfil-order", { orderId: order.id }); // slow work off the request
    return;
  }

  switch (payment.status) {
    case "underpaid":
      await db.orders.update(order.id, { status: "partially_paid", paidAmount: payment.receivedAmount });
      break;
    case "expired":
      await db.orders.update(order.id, { status: "cancelled" });
      break;
    case "expired_received":
      await db.orders.update(order.id, { status: "needs_review" });
      break;
    // pending / confirming: nothing to do
  }
}`,
      },
      {
        label: "Python",
        code: `def handle_event(event):
    if not event["event"].startswith("payment."):         # e.g. webhook.test
        return
    event_id, payment = event["eventId"], event["payment"]

    if not processed_events.insert_if_absent(event_id):   # duplicate
        return

    order = orders.by_payment_id(payment["id"]) or orders.by_id(payment["externalId"])
    if order is None or order.status == "paid":           # not ours / already paid
        return

    if payment["paid"]:                                     # confirmed or overpaid
        orders.update(order.id, status="paid", tx_hash=payment["txHash"],
                      paid_amount=payment["receivedAmount"])
        queue.enqueue(fulfil_order, order.id)
    elif payment["status"] == "underpaid":
        orders.update(order.id, status="partially_paid",
                      paid_amount=payment["receivedAmount"])
    elif payment["status"] == "expired":
        orders.update(order.id, status="cancelled")
    elif payment["status"] == "expired_received":
        orders.update(order.id, status="needs_review")`,
      },
      {
        label: "PHP",
        code: `<?php
function handleEvent(array $event): void {
    if (!str_starts_with($event["event"], "payment.")) return;     // e.g. webhook.test
    $payment = $event["payment"];
    if (!insertProcessedEventIfAbsent($event["eventId"])) return;   // duplicate

    $order = findOrderByPaymentId($payment["id"]) ?? findOrder($payment["externalId"]);
    if ($order === null || $order["status"] === "paid") return;

    if ($payment["paid"]) {                                         // confirmed or overpaid
        updateOrder($order["id"], ["status" => "paid", "tx_hash" => $payment["txHash"]]);
        enqueueFulfilment($order["id"]);
    } elseif ($payment["status"] === "underpaid") {
        updateOrder($order["id"], ["status" => "partially_paid"]);
    } elseif ($payment["status"] === "expired") {
        updateOrder($order["id"], ["status" => "cancelled"]);
    } elseif ($payment["status"] === "expired_received") {
        updateOrder($order["id"], ["status" => "needs_review"]);
    }
}`,
      },
    ],
  },
  {
    id: "errors",
    title: "Errors & rate limits",
    icon: AlertTriangle,
    paragraphs: [
      "Errors use HTTP status codes and a JSON body `{ \"error\": \"message\" }`. Validation errors also carry a `details` object naming the failing field. Error messages are meant for logs, not for buyers.",
      "Requests are limited per minute: 120 per live key, 30 per test key, and 60 per IP address for unauthenticated calls. Over the limit you get `429` with a `Retry-After` header in seconds. A `503` means a blockchain or price source was briefly unreachable and nothing was created; it carries `Retry-After` too. Retry 429, 503 and 500 with backoff. Don't retry 4xx errors without changing the request.",
    ],
    tables: [
      {
        columns: ["Status", "Meaning", "Retry?"],
        rows: [
          ["400", "Invalid request: missing/invalid field, unsupported chain/token pair, no active wallet for the pair, an invalid wallet address configured, a `webhookUrl` that isn't a public http(s) address, a `successUrl`/`cancelUrl` that isn't an http(s) URL, or a `webhookEndpointId` that isn't one of your endpoints. Field errors name the field in `field`.", "No. Fix the request or your wallet settings"],
          ["401", "Missing, invalid or revoked API key.", "No"],
          ["403", "Not allowed with this key (e.g. payment links with a test key), or the account isn't taking payments: suspended, or paused for overdue platform fees until the invoice on your Billing page is paid. A paused account's checkouts show buyers that the merchant needs to act.", "No. Pay or contact support"],
          ["404", "Payment not found, or it belongs to another account or mode.", "No"],
          ["409", "The payment can no longer be changed (e.g. a deposit was already seen).", "No. Read it again"],
          ["429", "Rate limit exceeded.", "Yes, after Retry-After"],
          ["500", "Unexpected server error.", "Yes, with backoff"],
          ["503", "Chain or price source unreachable; nothing was created.", "Yes, after Retry-After"],
        ],
      },
    ],
    examples: [
      {
        label: "Error body",
        code: `HTTP/1.1 400 Bad Request
{
  "error": "Invalid data format",
  "details": { "amount": { "_errors": ["Amount must be a positive number"] } }
}

HTTP/1.1 503 Service Unavailable
Retry-After: 30
{ "error": "Unable to reach the blockchain network right now, so this payment could not be opened. No funds have been requested. Please retry shortly." }`,
      },
      {
        label: "Retry (Node.js)",
        code: `// Retries 429/5xx using Retry-After; gives up on other 4xx at once.
async function withRetry(fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err.status === 429 || err.status >= 500;
      if (!retryable || i >= attempts) throw err;
      const waitS = err.retryAfter ?? Math.min(2 ** i, 30);
      await new Promise((r) => setTimeout(r, waitS * 1000));
    }
  }
}

const { payment } = await withRetry(() =>
  crypteo("/payments", { method: "POST", body: { amount: 25, externalId: "order_1042" } }),
);`,
      },
    ],
  },
  {
    id: "test-mode",
    title: "Test mode",
    icon: Terminal,
    paragraphs: [
      "Use a `test_` key to build your integration without real funds. Test payments are created with `isTest: true` and are never watched on-chain. Their checkout shows a 'Simulate Payment' button that marks the payment `confirmed`, which you can then read with `GET /payments/{id}`.",
      "Test payments don't send webhooks. To check an endpoint is reachable and verifies signatures, use 'Send test' next to it in Settings → Webhooks (it sends a signed `webhook.test` event). To exercise your payment handling, sign a sample payment event with your secret and POST it to your own endpoint, as below. Then use a small live payment to confirm the whole path end to end.",
    ],
    examples: [
      {
        label: "Send a signed test event (Node.js)",
        code: `// node send-test-webhook.mjs http://localhost:3000/webhooks/crypteo
import crypto from "node:crypto";

const url = process.argv[2];
const body = JSON.stringify({
  event: "payment.confirmed",
  eventId: "test_pay_1:confirmed:25",
  payment: {
    id: "test_pay_1", externalId: "order_1042", status: "confirmed", paid: true,
    chain: "eth", token: "usdc", expectedAmount: 25, receivedAmount: 25,
    txHash: "0xtest", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  timestamp: new Date().toISOString(),
});
const signature = crypto
  .createHmac("sha256", process.env.CRYPTEO_WEBHOOK_SECRET)
  .update(body)
  .digest("hex");

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Webhook-Id": "test_pay_1:confirmed:25", "X-Signature": signature },
  body,
});
console.log(res.status, await res.text());   // expect 2xx; then again → still 2xx, no double fulfilment`,
      },
      {
        label: "Send a signed test event (cURL)",
        code: `BODY='{"event":"payment.confirmed","eventId":"test_pay_1:confirmed:25","payment":{"id":"test_pay_1","externalId":"order_1042","status":"confirmed","paid":true,"chain":"eth","token":"usdc","expectedAmount":25,"receivedAmount":25,"txHash":"0xtest"},"timestamp":"2026-10-15T12:00:00Z"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$CRYPTEO_WEBHOOK_SECRET" | sed 's/^.* //')
curl -i -X POST "http://localhost:3000/webhooks/crypteo" \\
  -H "Content-Type: application/json" -H "X-Signature: $SIG" -d "$BODY"`,
      },
    ],
  },
  {
    id: "select-chain",
    title: "Select chain/token",
    icon: Network,
    paragraphs: [
      "Only needed if you build your own checkout instead of using `checkoutUrl`. `PATCH /payments/{id}` locks a flexible payment to one network: we price the USD amount in that token and return the address and amount the buyer must send.",
      "A payment can be re-pointed only while it is `pending`, nothing has been received, and it was created without a chain. Otherwise the request is refused with 400 or 409. Show the buyer `walletAddress` and `amount` exactly, plus `xrpDestinationTag` or `solMemoString` when present.",
      "`GET /payments/{id}` gives you the rest of a checkout on your own page: `availableWallets` for the coin list, `amountDueText` for the figure to show, and `paymentUri` for the QR code. Keep your API key on your server and fulfil orders from the webhook, never from what the browser reports.",
    ],
    examples: [
      {
        label: "cURL",
        code: `curl -X PATCH "${BASE}/payments/cmv2let0k0088iuglbuwggt6o" \\
  -H "Authorization: Bearer $CRYPTEO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "chain": "sol", "token": "usdc" }'`,
      },
      {
        label: "Response",
        code: `{
  "success": true,
  "payment": {
    "id": "cmv2let0k0088iuglbuwggt6o",
    "chain": "sol",
    "token": "usdc",
    "walletAddress": "ACTceHEAZYvx4kaukH5aByWo1ckf6Nh9R2iG27XSkN5D",
    "amount": 25,
    "xrpDestinationTag": null,
    "solMemoString": "ab919e8a",
    "paymentLink": null
  }
}`,
      },
    ],
  },
  {
    id: "payment-links",
    title: "Payment links",
    icon: Link2,
    paragraphs: [
      "A payment link is a reusable page: each visit opens a new payment session for `amount` USD. Use them for invoices, donations or social posts. They need a live key, because every payment through a link is real.",
      "Optionally pin a `chain` and `token` (together), set `expiresAt` (ISO date) and a `paymentLimit` (how many payments it accepts). A pinned pair needs an active wallet with a valid address for that network, or the request is refused with 400. A link never takes an address of its own: payments always go to your saved wallet.",
      "Each link sends its payments' webhooks to one place: pass `webhookEndpointId` (one of your endpoints, e.g. the site that sells it) or `webhookUrl` (a custom URL), not both. With neither, they go to your default endpoint. In the dashboard, the link form offers the same choice.",
    ],
    examples: [
      {
        label: "cURL",
        code: `curl -X POST "${BASE}/payment-links" \\
  -H "Authorization: Bearer $CRYPTEO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Premium Subscription",
    "description": "Monthly access",
    "amount": 29.99,
    "expiresAt": "2026-12-31T23:59:59Z",
    "paymentLimit": 100,
    "webhookEndpointId": "cmv9whe1b2c3d4e5f6g7h8i9"
  }'`,
      },
      {
        label: "Response",
        code: `{
  "success": true,
  "paymentLink": {
    "id": "cmv9a1b2c3d4e5f6g7h8i9j0k",
    "url": "https://crypteo.io/pay/cmv9a1b2c3d4e5f6g7h8i9j0k",
    "title": "Premium Subscription",
    "amount": 29.99,
    "isActive": true,
    "expiresAt": "2026-12-31T23:59:59.000Z",
    "webhookUrl": null,
    "webhookEndpointId": "cmv9whe1b2c3d4e5f6g7h8i9"
  }
}`,
      },
    ],
  },
  {
    id: "telegram",
    title: "Telegram bot",
    icon: Send,
    paragraphs: [
      "The Crypteo bot posts pay buttons in Telegram, with no code on your side. Under Payment links in the dashboard, choose Connect a chat to get a one-time code, valid for 15 minutes, with links for a private chat, a group or a channel. For a channel, add the bot as an admin and post the `/connect` message shown in the dashboard.",
      "In a connected chat, `/pay 25 Blue hoodie` creates a payment link for 25 USD and posts a button to it. Payments through that button are ordinary payment link payments: they appear in your dashboard and send webhooks to your default endpoint. The bot also reports every paid payment on your account to connected chats, whatever created it. Each connection has its own switch in the dashboard, or use `/reports on` and `/reports off` in the chat: reports start on for private chats and off for groups and channels.",
    ],
    notes: [
      "In a group, only its admins can use the bot.",
      "Make the bot an admin in a group, or write `/pay@yourbot`. Telegram may otherwise keep plain commands from it.",
      "Self-hosting: create a bot with BotFather, set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET`, then run `scripts/telegram-setup.ts` once.",
    ],
  },
  {
    id: "tags-memos",
    title: "XRP tags & Solana memos",
    icon: AlertTriangle,
    paragraphs: [
      "XRP and Solana payments get a per-payment identifier, `xrpDestinationTag` or `solMemoString`, shown to the buyer at checkout. It lets one wallet receive many payments at once and still match each one exactly.",
      "A payment sent without it (common from exchange withdrawals) is still detected and matched by amount. Use a self-custodied XRP address you control: an exchange deposit address that requires its own fixed tag is not supported, because buyers are shown the per-payment tag. XRP wallets must be classic `r…` addresses.",
    ],
  },
  {
    id: "chains",
    title: "Supported chains",
    icon: CheckCircle,
    paragraphs: [
      "Pass these lowercase `chain`/`token` pairs. A buyer is only offered pairs for which you have an active, valid wallet in Wallets. Zcash is watched on transparent (`t1…`/`t3…`) addresses only.",
    ],
    tables: [
      {
        columns: ["chain", "tokens"],
        rows: [
          ["eth", "eth, usdc, usdt"],
          ["sol", "sol, usdc, usdt"],
          ["btc", "btc"],
          ["xrp", "xrp"],
          ["bsc", "bnb, usdc, usdt (BEP-20)"],
          ["polygon", "pol, usdc, usdt"],
          ["tron", "trx, usdt (TRC-20)"],
          ["doge", "doge"],
          ["zec", "zec (transparent addresses only)"],
          ["ada", "ada"],
        ],
      },
    ],
  },
];
