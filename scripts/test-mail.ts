import "dotenv/config";
import { adminRecipients } from "../lib/admin-alerts";
import { sendEmail } from "../lib/mailer";
import {
  paymentSuccessHtml,
  paymentUnderpaidHtml,
  paymentExpiredHtml,
} from "../lib/emails/templates";

const TO = adminRecipients()[0] || "admin@crypteo.io";

const MOCK = {
  merchantName: "Acme Store",
  paymentId: "pay_cm9test1234567890",
  externalId: "order_98765",
  chain: "eth",
  token: "USDC",
  expectedAmount: 149.99,
  walletAddress: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
  customerEmail: "customer@example.com",
  createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  dashboardUrl: "https://crypteo.io/dashboard/payments/pay_cm9test1234567890",
};

async function run() {
  console.log(`Sending test emails to: ${TO}\n`);

  // 1. Success
  console.log("Sending: Payment Success...");
  const r1 = await sendEmail({
    to: TO,
    subject: "✅ [TEST] Payment Received: 149.99 USDC",
    html: paymentSuccessHtml({
      ...MOCK,
      receivedAmount: 149.99,
      txHash: "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1",
      confirmedAt: new Date().toISOString(),
    }),
  });
  console.log(`  → ${r1.success ? "Sent ✓" : "FAILED ✗"}\n`);

  // 2. Underpaid
  console.log("Sending: Payment Underpaid...");
  const r2 = await sendEmail({
    to: TO,
    subject: "⚠️ [TEST] Underpaid: 100.00 USDC received (expected 149.99 USDC)",
    html: paymentUnderpaidHtml({
      ...MOCK,
      receivedAmount: 100.00,
      shortfall: 49.99,
      txHash: "0xdef456abc123def456abc123def456abc123def456abc123def456abc123def4",
    }),
  });
  console.log(`  → ${r2.success ? "Sent ✓" : "FAILED ✗"}\n`);

  // 3. Expired with late funds
  console.log("Sending: Payment Expired (late funds)...");
  const r3 = await sendEmail({
    to: TO,
    subject: "🕐 [TEST] Late Payment Detected, Not Credited",
    html: paymentExpiredHtml({
      ...MOCK,
      receivedAmount: 149.99,
      txHash: "0x789abc123def456789abc123def456789abc123def456789abc123def456789a",
      expiredAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      hadFunds: true,
    }),
  });
  console.log(`  → ${r3.success ? "Sent ✓" : "FAILED ✗"}\n`);

  // 4. Expired no funds
  console.log("Sending: Payment Expired (no funds)...");
  const r4 = await sendEmail({
    to: TO,
    subject: "⏱️ [TEST] Payment Expired: No Funds Received",
    html: paymentExpiredHtml({
      ...MOCK,
      receivedAmount: null,
      txHash: null,
      expiredAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      hadFunds: false,
    }),
  });
  console.log(`  → ${r4.success ? "Sent ✓" : "FAILED ✗"}\n`);

  console.log("Done. Check your inbox.");
}

run().catch(console.error);
