# Crypteo

**Crypteo** (crypteo.io) is a non-custodial crypto payment gateway. Buyers pay the merchant's own wallet directly; Crypteo watches the chain, attributes each deposit to its checkout session and notifies the merchant. No processor balance to freeze, no exchange in the middle, no KYC.

It is open source under the MIT licence: use the hosted service at [crypteo.io](https://crypteo.io), or run your own instance with Docker and pay no platform fee. Self-hosted, it is fully white label: your domain, your logo and colours, your support contact, and payment links on your merchants' own subdomains.

The API reference lives at `/docs` on any instance (hosted: `https://crypteo.io/docs`). A WooCommerce plugin is in `integrations/woocommerce/crypteo-for-woocommerce/`; point its "API base URL" setting at your instance.

---

## 🚀 Key Features

- **Non-Custodial by Design**: Payments settle directly to your blockchain addresses. Crypteo never holds your funds.
- **Multi-Chain Support**: Native support for **Ethereum**, **Bitcoin**, **Solana**, **XRP**, **BNB Smart Chain**, **Polygon**, **Tron**, **Dogecoin**, **Zcash** (transparent addresses) and **Cardano** — including USDC/USDT as ERC-20, BEP-20, Polygon, **SPL** (Solana) and **TRC-20** (Tron, USDT only) tokens.
- **Smart Payment Attribution**: Proximity-scoring algorithm matches incoming transactions to the correct session — even when multiple sessions share the same wallet.
- **Exchange-Friendly Detection**: Per-session XRP destination tags and Solana memos are used when present, but are never *required* — deposits withdrawn from custodial exchanges (which can't attach them) fall back to balance-diff detection and are still attributed correctly.
- **Adaptive Polling Engine**: Real-time blockchain monitoring that scales from 15-second "hot" scans to hourly "cold" sweeps.
- **Sweep-Resilient Confirmation**: Once a deposit is attributed it is tracked by transaction hash, and confirmations are floored by observed age — so a payment still settles correctly even after the merchant moves the funds out of the receiving wallet.
- **Automatic Session Expiry**: Stale payment sessions are auto-expired to prevent attribution pollution, with a 15-minute grace period for late deposits (`expired_received`).
- **Precision-Safe Balance Diffs**: Balance differences below floating-point precision are discarded, so an unchanged wallet balance can never be misread as a sub-wei "deposit" and flag an unpaid session as underpaid.
- **Validated Receiving Addresses**: Wallet addresses are checked against their chain (format and checksum) when saved, so a merchant can't publish an address from the wrong network at checkout.
- **Orphan Transaction Recovery**: Unmatched transactions are logged for admin review and manual resolution — no payment is ever lost.
- **Resilient Proxy Rotation**: Advanced proxy routing with health tracking, auto-sidelining, and real RPC fallback monitoring to bypass RPC rate limits.
- **Developer-First API**: RESTful API with SHA-256 protected keys and automated webhook notifications.
- **Interactive API Playground**: Built-in, side-by-side API tester to safely simulate payment creation and test responses directly from the dashboard.
- **Hosted Checkout**: Two-panel checkout with a coin-card network picker, numbered payment steps, QR codes and real-time status updates; built for phones first.
- **Checkout Branding**: merchants put their own logo (cropped in the browser, re-encoded on the server) and theme colour on every checkout and payment link, with contrast kept readable automatically.
- **Secure Infrastructure**: Password hashing with Argon2id and transaction deduplication to prevent double-credit attacks.
- **Production-Ready Hardening**: Docker health checks, automated migrations, worker concurrency guards, and instant admin failure workflows via Email.
- **Worker Liveness Monitoring**: The payment worker publishes a heartbeat on every poll cycle, surfaced via `/api/health`. Because the worker has no HTTP surface of its own, this is what makes a stalled poller visible — admins are alerted rather than discovering it through undetected deposits.
- **Verified Database Backups**: Nightly dumps are integrity-checked (`gzip -t`), content-verified, and retained with a floor that survives a run of failures. Every outcome is written to a status file that the monitor alerts on, so a failing backup can't pass unnoticed.
- **Bot Protection & Rate Limiting**: Cloudflare Turnstile integration and comprehensive backend rate limits across all API routes.
- **Merchant Dashboard** (`/dashboard`): overview (status breakdown and recent payments in one switchable card), payments, payment links, wallets, API keys, checkout branding, webhook endpoints (one per site), billing and notifications.
- **Admin Console** (`admin.crypteo.io`, its own host): platform-wide overview, merchants (suspend, fee exemption, messages), analytics, revenue and fee settings, orphan review, contact inbox, fee wallets and the blog.
- **Platform Fees**: one fee schedule edited by admins drives both billing (per-merchant billing months, invoices paid in USDT/USDC, a checkout hold when overdue) and every fee figure on the public site.
- **Blog with Rich-Text Editor** (`/blog`, admin `/blog`): admins write in a rich-text editor (Tiptap) with an image gallery and full version history; every body is sanitised on the server, and publishing refreshes the cached pages at once.
- **Marketing Site**: home, pricing, FAQ (with FAQPage JSON-LD), about, contact, API reference (`/docs`), API playground, terms and privacy.
- **Self-Custody Guidance**: merchants are steered to wallets they hold the keys to (Base Wallet, Trust Wallet), not exchange deposit addresses, at signup, on the wallets page and in the FAQ.

---

## 🛠 Tech Stack

- **Frontend/Backend**: [Next.js 16](https://nextjs.org) (App Router) & React 19
- **Database**: [PostgreSQL](https://www.postgresql.org/) with [Prisma ORM](https://www.prisma.io/)
- **Authentication**: [NextAuth.js](https://next-auth.js.org/) & [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4 (design from the Clavudkit template), [Framer Motion](https://www.framer.com/motion/), [GSAP](https://gsap.com/) & [Recharts](https://recharts.org/)
- **Blog**: [Tiptap](https://tiptap.dev/) rich-text editor, [sanitize-html](https://github.com/apostrophecms/sanitize-html) on every render, [marked](https://marked.js.org/) for posts written before the editor
- **Images**: [sharp](https://sharp.pixelplumbing.com/) re-encodes every upload (logos, blog gallery); [react-image-crop](https://github.com/dominictobias/react-image-crop) for the in-browser crop step
- **Blockchain SDKs**: `ethers.js` (Ethereum, BSC, Polygon), `@solana/web3.js`, `xrpl`, `axios` (Esplora for BTC, Blockbook for DOGE/ZEC, TronGrid for Tron, Koios for Cardano)
- **Infrastructure**: `https-proxy-agent` for robust proxy rotation.
- **Background Tasks**: [Node-cron](https://github.com/node-cron/node-cron) for payment polling, webhook retries, and scheduled system monitors.

---

## 📦 Getting Started

### Prerequisites

- Node.js (v20+)
- PostgreSQL
- Docker & Docker Compose (recommended for deployment)

### Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/crypteo-io/crypteo.git
   cd crypteo
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Environment Setup**:
   Copy `.env.example` to `.env` and fill in your credentials.

   ```bash
   cp .env.example .env
   ```

   _Note: Ensure `DATABASE_URL` and `NEXTAUTH_SECRET` are correctly set._

4. **Database Migration & Seed**:

   ```bash
   npx prisma migrate dev
   npx prisma db seed
   ```

   _The admin account comes from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `.env` (required — there is no default password). Outside production the seed also creates a demo merchant (password from `SEED_DEMO_PASSWORD`, or random and printed once). The seed refuses to run with `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=true`, and then only ensures the admin exists._

5. **Run the Development Server**:

   ```bash
   npm run dev
   ```

   Access the app at `http://localhost:3000`.

6. **Run the Payment Worker** (separate process — the dev server does **not**
   detect deposits on its own):

   ```bash
   npx tsx workers/scheduler.ts
   ```

---

## 🧪 Testing

Unit tests run on [Vitest](https://vitest.dev/) and cover the core money-path
logic: amount classification, adaptive polling schedule, attribution matching,
proxy rotation, confirmation derivation, float-noise-safe balance diffs,
per-chain wallet address validation, and the adapter/token support matrix
(which asserts every chain/token pair the product advertises is actually backed
by a working adapter).

```bash
npm test              # run once
npm run test:watch    # watch mode
npm run test:coverage # with coverage
```

---

## 🐳 Docker Deployment (self-hosting)

1. Point your domain and `admin.<your domain>` at the server, and set `NEXTAUTH_URL=https://<your domain>` in `.env` (the admin console is served on the `admin.` host, derived from it).
2. Put a TLS certificate and key covering both names in `ssl/cert.pem` and `ssl/key.pem`, and replace `example.com` in `nginx/nginx.conf`.
3. Fill in `.env` from `.env.example`: database, `NEXTAUTH_SECRET`, `TWO_FACTOR_ENCRYPTION_KEY`, SMTP (sign-in codes are emailed), Turnstile keys, `ADMIN_EMAILS`, `SEED_ADMIN_*`, and `WEBHOOK_BLOCKED_IPS` (your server's own public IPs).
4. Start the stack, then create the first admin with `SEED_ALLOW_PRODUCTION=true` (see the seed note above).

nginx listens on the host's 80/443; behind another proxy, set `NGINX_HTTP_BIND` / `NGINX_HTTPS_BIND` (see `docker-compose.yml`). Platform fees are off until an admin turns billing on, so your own merchants are never charged unless you choose to.

**Merchant custom domains** (payment links on `pay.theirstore.com`): merchants add a TXT record to prove ownership and a CNAME to `CUSTOM_DOMAIN_TARGET` (default `domains.<your domain>`, a DNS-only record pointing at your server). Set `COMPOSE_PROFILES=custom-domains` to start Caddy (`caddy/Caddyfile`), which gets each verified hostname a Let's Encrypt certificate on demand. Caddy needs the host's 80/443, so move nginx to other ports (`NGINX_HTTPS_BIND=8443`) and reach your own domain on that port (for example a Cloudflare Origin Rule), or put your own edge proxy in front that asks `http://127.0.0.1:3010/api/custom-domains/allowed?domain=<host>` and forwards to the app's loopback port.

```bash
docker compose up --build -d
```

This will spin up:

| Service     | Description                                        |
| ----------- | -------------------------------------------------- |
| **migrate** | Runs Prisma migrations, then exits                 |
| **app**     | Next.js application on port 3000                   |
| **worker**  | Background scheduler for payment polling & expiry  |
| **postgres**| Database on port 5432                              |
| **backup**  | Verified daily database backups (02:00, 7-day retention, min 3 kept) |
| **nginx**   | Reverse proxy on ports 80/443                      |
| **monitor** | Health monitoring: app, nginx, worker heartbeat, stuck payments, backup freshness |

### Startup Order

```
postgres (healthy) → migrate (completes) → app + worker → nginx + monitor
```

The `migrate` service runs `prisma migrate deploy` on startup, ensuring the database schema is always up-to-date before the app starts. See [`migrations/README.md`](migrations/README.md) for details.

### Production deploys & rollback

Production hosts use [`deploy.sh`](deploy.sh) for tag-based deploys with a
two-version buffer, health-gated bring-up, and one-command rollback. The
deployed git tag is passed through as `APP_VERSION` and baked into Next's
`deploymentId`, so clients holding a stale bundle reload cleanly instead of
hitting "older or newer deployment" errors.

```bash
./deploy.sh                # deploy the latest git tag
./deploy.sh deploy v1.2.3  # deploy a specific tag
./deploy.sh rollback       # roll back to the previous tag
./deploy.sh status         # show current/previous versions + container state
SEED=true ./deploy.sh      # also run `prisma db seed` after migrations
```

---

## 🔌 API Overview

All public API endpoints require an API key, sent as `x-api-key: YOUR_API_KEY` or
`Authorization: Bearer YOUR_API_KEY`. The full reference is served at `/docs`.

### Supported Chains & Tokens

Chain and token inputs are case-insensitive. A pair not listed here is rejected
at payment creation with a `400` — a session is never created on a pair the
worker cannot watch.

| Chain | Tokens            | Per-session identifier      | Confirmations |
| ----- | ----------------- | --------------------------- | ------------- |
| `eth` | `eth`, `usdc`, `usdt` (ERC-20) | —                | 12            |
| `sol` | `sol`, `usdc`, `usdt` (SPL)    | Memo (optional)  | 1             |
| `btc` | `btc`             | —                           | 3             |
| `xrp` | `xrp`             | Destination tag (optional)  | 1             |
| `bsc` | `bnb`, `usdc`, `usdt` (BEP-20) | —                | 30            |
| `polygon` | `pol`, `usdc`, `usdt`      | —                | 64            |
| `tron` | `trx`, `usdt` (TRC-20)        | —                | 19 (solidified) |
| `doge` | `doge`           | —                           | 6             |
| `zec` | `zec` (transparent only) | —                    | 10            |
| `ada` | `ada`             | —                           | 15            |

Destination tags and memos improve attribution when several sessions share one
receiving wallet, but are optional: a deposit sent without one (typical of
custodial exchange withdrawals) is still detected and attributed by amount.

Receiving wallets are validated per chain when saved from the dashboard:

| Chain | Accepted address formats |
| ----- | ------------------------ |
| `eth` | `0x…` (EIP-55 checksum enforced when mixed-case) |
| `sol` | Base58 public key (32 bytes) |
| `btc` | Mainnet only: `1…`, `3…`, `bc1q…`, `bc1p…` (checksum verified) |
| `xrp` | Classic `r…` address (X-addresses are rejected; destination tags are assigned per session) |
| `bsc`, `polygon` | `0x…` (same rules as `eth`) |
| `tron` | Base58 `T…` address (checksum verified) |
| `doge` | `D…` (P2PKH) or `9…`/`A…` (P2SH), checksum verified |
| `zec` | Transparent `t1…`/`t3…`, or a TEX `tex1…` address (stored as its `t1…` form). Shielded (`zs…`) and unified (`u1…`) addresses can't be watched and are rejected |
| `ada` | Shelley mainnet `addr1…` (Byron and stake addresses are rejected) |

### 1. Create a Payment

`POST /api/public/v1/payments`

Initiate a new payment. If `chain` and `token` are omitted, the user selects them on the hosted checkout page.

**Request Body:**

```json
{
  "amount": 99.99,
  "chain": "eth",
  "token": "USDC",
  "externalId": "order_12345",
  "customerEmail": "user@example.com",
  "webhookUrl": "https://your-app.com/webhooks",
  "metadata": { "userId": "123" }
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "payment": {
    "id": "pay_xyz...",
    "checkoutUrl": "https://domain.com/checkout/pay_xyz...",
    "walletAddress": "0x...",
    "amount": 99.99,
    "chain": "eth",
    "token": "USDC",
    "expiresAt": "2024-12-31T23:59:59Z"
  }
}
```

### 2. Retrieve a Payment

`GET /api/public/v1/payments/[id]`

Fetch current status and details of a payment.

**Response (200 OK):**

```json
{
  "success": true,
  "payment": {
    "id": "pay_xyz...",
    "status": "confirmed",
    "expectedAmount": 99.99,
    "receivedAmount": 99.99,
    "txHash": "0xabc...",
    "externalId": "order_12345"
  },
  "availableWallets": [{ "chain": "eth", "token": "USDC", "address": "0x..." }]
}
```

### 3. Update Payment Selection

`PATCH /api/public/v1/payments/[id]`

Select or change the chain and token for a pending payment if it wasn't specified during creation. Once a chain is selected, a unique wallet address is locked in for monitoring.

**Request Body:**

```json
{
  "chain": "sol",
  "token": "USDC"
}
```

### 🔔 Webhooks Configuration

Crypteo sends POST requests to your `webhookUrl` whenever a payment status changes (a deposit is detected, confirmed, underpaid, or the session expires).

**Payload Structure:**

```json
{
  "event": "payment.confirmed",
  "eventId": "pay_xyz...:confirmed:99.99",
  "payment": {
    "id": "pay_xyz...",
    "externalId": "order_12345",
    "status": "confirmed",
    "chain": "eth",
    "token": "usdc",
    "expectedAmount": 99.99,
    "receivedAmount": 99.99,
    "txHash": "0xabc...",
    "createdAt": "2026-09-30T10:00:00.000Z",
    "updatedAt": "2026-09-30T10:04:12.000Z"
  },
  "timestamp": "2026-09-30T10:04:12.000Z"
}
```

**Delivery:** respond with a 2xx within **10 seconds**. Redirects are **not followed** (a 3xx counts as a failed delivery), and failures are retried with backoff. `eventId` (also sent as the `X-Webhook-Id` header) is identical across retries and manual resends of the same event — use it to deduplicate.

**Webhook Security Verification:** When a merchant sets a `webhookSecret`, each
webhook request carries an `X-Signature` header — the HMAC-SHA256 of the raw JSON
body keyed by that secret. Recompute it on your end to verify payload integrity.

---

## 📂 Project Structure

| Directory       | Description                                          |
| --------------- | ---------------------------------------------------- |
| `/app`          | Next.js pages, API routes, and layouts               |
| `/components`   | UI: `site` (marketing shell), `dashboard`, `layout`, `checkout`, `auth`, `blog`, `docs` |
| `/lib/content`  | Shared marketing copy: FAQ and fee tiers             |
| `/lib/blog`     | Blog validation, queries, sanitising, versions, media rules and cache busting |
| `/lib`          | Core logic, blockchain adapters, and database utils  |
| `/lib/payment`  | Attribution matching, orphan logging, notifications  |
| `/lib/chains`   | Blockchain adapters (EVM ×3, Solana, XRP, Bitcoin, Tron, Blockbook, Cardano) |
| `/workers`      | Background processes for payment polling & expiry    |
| `/prisma`       | Database schema, migrations, and seed scripts        |
| `/migrations`   | Docker migration service scripts                     |
| `/nginx`        | Production reverse proxy configuration               |
| `/postgres`     | Database initialization and backup scripts           |

---

## 🛡 Security

- **Self-Custodial**: We never ask for your private keys. You only provide public receiving addresses, which are validated against their chain before they can be shown to buyers.
- **Hashed Secrets**: API keys are stored as SHA-256 hashes.
- **Distributed Rate Limiting**: Postgres-backed fixed-window limiting that holds across all app replicas, plus Cloudflare Turnstile on public forms and rate-limited auth/OTP endpoints.
- **SSRF-Safe Webhooks**: Merchant webhook URLs are validated (and DNS-resolved) to reject private/loopback/link-local targets, both when saved and when delivered.
- **Brute-Force Resistant OTP**: Cryptographically random codes, capped verification attempts, and constant-time comparison.
- **Audit Logs**: Every webhook attempt and email notification is logged for transparency.
- **Session Isolation**: Per-session XRP destination tags and Solana memos prevent cross-session payment attribution; where absent, deterministic amount-proximity matching arbitrates so a deposit is claimed by exactly one session.
- **Minimal Health Surface**: `/api/health` is unauthenticated by design (container and proxy probes depend on it), so it reports operational state as flags and counters only — never raw driver errors, which can carry connection credentials.
- **Double-Credit Protection**: Transaction hashes are unique-constrained and checked before crediting; unattributable deposits become `OrphanTransaction` rows for manual review rather than being dropped.

---
