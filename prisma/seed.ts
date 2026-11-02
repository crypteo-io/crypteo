import { PrismaClient } from "@prisma/client";
import { SAMPLE_BLOG_POSTS } from "./seed-blog";
import { hash } from "argon2";
import crypto from "crypto";

const prisma = new PrismaClient();

const isProduction = process.env.NODE_ENV === "production";

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Create the merchant if missing. Never touches an existing account's
 * password: re-running the seed used to reset seeded accounts to a password
 * committed in this file, including in production.
 */
async function ensureMerchant(data: {
  email: string;
  name: string;
  password: string;
  role: string;
}) {
  const existing = await prisma.merchant.findUnique({
    where: { email: data.email },
  });
  if (existing) return { merchant: existing, created: false };

  const merchant = await prisma.merchant.create({
    data: {
      email: data.email,
      name: data.name,
      password: await hash(data.password),
      role: data.role,
      emailVerified: new Date(),
    },
  });
  return { merchant, created: true };
}

async function main() {
  // The seed creates privileged and demo accounts; running it against the
  // production database by accident must be impossible, not merely unlikely.
  if (isProduction && process.env.SEED_ALLOW_PRODUCTION !== "true") {
    throw new Error(
      "Refusing to seed with NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=true to create the admin account (demo data is never seeded in production).",
    );
  }

  console.log("🌱 Seeding database...");

  // 1. Create Admin
  const adminEmail = (
    process.env.SEED_ADMIN_EMAIL || "admin@crypteo.io"
  ).toLowerCase();
  const adminName = process.env.SEED_ADMIN_NAME || "Platform Administrator";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error("SEED_ADMIN_PASSWORD is required (no default is provided).");
  }

  const { merchant: admin, created: adminCreated } = await ensureMerchant({
    email: adminEmail,
    name: adminName,
    password: adminPassword,
    role: "admin",
  });

  console.log(
    adminCreated
      ? `✅ Admin created: ${admin.email}`
      : `ℹ️  Admin already exists, left unchanged: ${admin.email}`,
  );

  if (isProduction) {
    console.log("✨ Production seed completed (admin only).");
    return;
  }

  // 2. Create a Test Merchant. Demo accounts share one password: from
  // SEED_DEMO_PASSWORD, or a random one printed below only when an account is
  // actually created (it's not stored anywhere else).
  const demoPassword =
    process.env.SEED_DEMO_PASSWORD || crypto.randomBytes(12).toString("base64url");
  const printDemoPassword = !process.env.SEED_DEMO_PASSWORD;

  const merchantEmail = "user@example.com";
  const { merchant, created: merchantCreated } = await ensureMerchant({
    email: merchantEmail,
    name: "Test Merchant",
    password: demoPassword,
    role: "merchant",
  });

  console.log(
    merchantCreated
      ? `✅ Merchant created: ${merchant.email}`
      : `ℹ️  Merchant already exists, left unchanged: ${merchant.email}`,
  );

  // 2.1 A sandbox API key, only if the merchant has none. The raw value is
  // random and printed exactly once — only its hash is stored. Test-mode
  // only: a seed must never mint a key that can create live payments.
  const existingKeys = await prisma.apiKey.count({
    where: { merchantId: merchant.id, isActive: true },
  });
  if (existingKeys === 0) {
    const testKeyRaw = `test_${crypto.randomBytes(24).toString("hex")}`;
    await prisma.apiKey.create({
      data: {
        merchantId: merchant.id,
        label: "Sandbox Test Key",
        keyHash: sha256(testKeyRaw),
        keyPrefix: `${testKeyRaw.slice(0, 9)}...`,
        isTest: true,
      },
    });
    console.log(
      `✅ Sandbox test key for ${merchant.email} (shown once): ${testKeyRaw}`,
    );
  }

  // 2b. Create a Second Merchant with limited wallets
  const merchant2Email = "merchant2@example.com";
  const { merchant: merchant2, created: merchant2Created } =
    await ensureMerchant({
      email: merchant2Email,
      name: "Limited Merchant",
      password: demoPassword,
      role: "merchant",
    });

  console.log(
    merchant2Created
      ? `✅ Second Merchant created: ${merchant2.email}`
      : `ℹ️  Second Merchant already exists, left unchanged: ${merchant2.email}`,
  );

  if (printDemoPassword && (merchantCreated || merchant2Created)) {
    console.log(`🔑 Demo merchant password (shown once): ${demoPassword}`);
  }

  // 3. Create Wallets for the Merchant
  const chains = [
    {
      chain: "btc",
      token: "btc",
      address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    },
    {
      chain: "eth",
      token: "eth",
      address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    },
    {
      chain: "sol",
      token: "sol",
      address: "8pPj4L2YgT9K9Z7Z8pPj4L2YgT9K9Z7Z8pPj4L2YgT9K",
    },
    {
      chain: "xrp",
      token: "xrp",
      address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    },
    {
      chain: "eth",
      token: "usdc",
      address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    },
    {
      chain: "eth",
      token: "usdt",
      address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    },
    {
      chain: "sol",
      token: "usdc",
      address: "8pPj4L2YgT9K9Z7Z8pPj4L2YgT9K9Z7Z8pPj4L2YgT9K",
    },
    {
      chain: "sol",
      token: "usdt",
      address: "8pPj4L2YgT9K9Z7Z8pPj4L2YgT9K9Z7Z8pPj4L2YgT9K",
    },
  ];

  for (const c of chains) {
    await prisma.wallet.upsert({
      where: {
        merchantId_chain_token: {
          merchantId: merchant.id,
          chain: c.chain,
          token: c.token,
        },
      },
      update: {
        address: c.address,
        isActive: true,
      },
      create: {
        merchantId: merchant.id,
        chain: c.chain,
        token: c.token,
        address: c.address,
      },
    });
  }

  console.log("✅ Wallets created");

  // 3b. Create only ETH and BTC wallets for Second Merchant
  const m2Chains = [
    {
      chain: "btc",
      token: "btc",
      address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlm",
    },
    {
      chain: "eth",
      token: "eth",
      address: "0x1111111111111111111111111111111111111111",
    },
  ];

  for (const c of m2Chains) {
    await prisma.wallet.upsert({
      where: {
        merchantId_chain_token: {
          merchantId: merchant2.id,
          chain: c.chain,
          token: c.token,
        },
      },
      update: { address: c.address, isActive: true },
      create: {
        merchantId: merchant2.id,
        chain: c.chain,
        token: c.token,
        address: c.address,
      },
    });
  }

  console.log("✅ Second Merchant wallets created");

  // 3c. Sample blog posts. Created if missing, never overwritten: an admin
  // may have edited them since.
  for (const post of SAMPLE_BLOG_POSTS) {
    await prisma.blogPost.upsert({
      where: { slug: post.slug },
      update: {},
      create: { ...post, status: "published", authorId: admin.id },
    });
  }
  console.log("✅ Sample blog posts ensured");

  // 4. Generate Dummy Payments
  const statuses = [
    "confirmed",
    "confirmed",
    "confirmed",
    "confirmed",
    "confirming",
    "pending",
    "pending",
    "underpaid",
    "overpaid",
    "expired",
  ];
  const now = new Date();

  // Clear old payments for this merchant to avoid cluttering if re-running
  await prisma.payment.deleteMany({ where: { merchantId: merchant.id } });

  console.log("⏳ Generating 200 dummy payments...");

  // Fixed ID payment for testing
  await prisma.payment.create({
    data: {
      id: "pay_seed_test_123",
      merchantId: merchant.id,
      chain: "eth",
      token: "usdc",
      expectedAmount: 100,
      walletAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      status: "pending",
      customerEmail: "seed_test@example.com",
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    },
  });

  for (let i = 0; i < 200; i++) {
    const randomChain = chains[Math.floor(Math.random() * chains.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const amount = parseFloat((Math.random() * 500 + 10).toFixed(2));

    // Spread payments over the last 30 days
    // Ensure we have a good amount of payments in the last 7 days for the chart
    const isRecent = Math.random() > 0.3; // 70% chance of being in last 7 days
    const daysBack = isRecent
      ? Math.floor(Math.random() * 7)
      : Math.floor(Math.random() * 23) + 7;

    const createdAt = new Date(now);
    createdAt.setDate(now.getDate() - daysBack);
    createdAt.setHours(
      Math.floor(Math.random() * 24),
      Math.floor(Math.random() * 60),
    );

    const expiresAt = new Date(createdAt);
    expiresAt.setMinutes(createdAt.getMinutes() + 15);

    await prisma.payment.create({
      data: {
        merchantId: merchant.id,
        chain: randomChain.chain,
        token: randomChain.token,
        expectedAmount: amount,
        walletAddress: randomChain.address,
        status,
        receivedAmount:
          status === "confirmed" || status === "overpaid"
            ? amount
            : status === "underpaid"
              ? amount * 0.8
              : null,
        createdAt,
        updatedAt: status === "confirmed" ? createdAt : now,
        expiresAt,
        txHash:
          status === "confirmed" ||
          status === "confirming" ||
          status === "overpaid" ||
          status === "underpaid"
            ? `0x${Math.random().toString(16).slice(2, 66)}`
            : null,
        customerEmail: `customer${i}@example.com`,
      },
    });
  }

  console.log("✅ 200 dummy payments generated");
  console.log("✨ Seeding completed!");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
