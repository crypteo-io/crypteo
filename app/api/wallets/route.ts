import { auth } from "@/lib/auth";
import { isValidAddress, normalizeAddress } from "@/lib/chains/address";
import { isSupportedPair } from "@/lib/chains/registry";
import { prisma } from "@/lib/db";
import { maskAddress, notifyAccountSecurityChange } from "@/lib/mailer";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { verifyChallenge } from "@/lib/two-factor";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ADDRESS_LABELS: Record<string, string> = {
  eth: "Ethereum",
  btc: "Bitcoin",
  sol: "Solana",
  xrp: "XRP",
  bsc: "BNB Smart Chain",
  polygon: "Polygon",
  tron: "Tron",
  doge: "Dogecoin",
  zec: "Zcash (transparent)",
  ada: "Cardano",
};

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const wallets = await prisma.wallet.findMany({
    where: { merchantId: session.user.id },
  });
  return NextResponse.json(wallets);
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const merchant = await prisma.merchant.findUnique({
    where: { id: session.user.id },
  });

  if (!merchant) {
    return NextResponse.json(
      { error: "Session expired or merchant not found. Please log in again." },
      { status: 401 },
    );
  }

  const walletSchema = z.object({
    chain: z.string().min(1),
    token: z.string().min(1),
    address: z.string().trim().min(1),
    isActive: z.boolean().optional().default(true),
    xrpTag: z
      .string()
      .regex(
        /^\d{1,10}$/,
        "Destination Tag must be a numeric value (up to 10 digits)",
      )
      .optional()
      .nullable(),
    code: z.string().trim().regex(/^\d{6}$/).optional(),
  });

  const rawBody = await req.json().catch(() => ({}));
  const parseResult = walletSchema.safeParse(rawBody);

  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.format() },
      { status: 400 },
    );
  }

  const {
    chain: rawChain,
    token: rawToken,
    address: rawAddress,
    isActive,
    xrpTag,
    code,
  } = parseResult.data;

  const chain = rawChain.toLowerCase();
  const token = rawToken.toLowerCase();
  // Stored in the form the chain reads use (e.g. a Zcash TEX address as t1…).
  const address = normalizeAddress(chain, rawAddress);

  // A wallet on a pair no adapter watches, or at an address the chain can't
  // read, is handed to buyers at checkout and then never detects a deposit.
  // Only a new or changed address is checked: the enable/disable toggle
  // re-posts the stored one, and a merchant must always be able to disable a
  // wallet saved before this validation existed.
  const existing = await prisma.wallet.findUnique({
    where: {
      merchantId_chain_token: { merchantId: session.user.id, chain, token },
    },
  });
  const addressChanged = existing?.address !== address;

  if (addressChanged && !isSupportedPair(chain, token)) {
    return NextResponse.json(
      { error: `Unsupported chain/token pair: ${chain}/${token}` },
      { status: 400 },
    );
  }
  if (addressChanged && !isValidAddress(chain, address)) {
    return NextResponse.json(
      {
        error: `That is not a valid ${ADDRESS_LABELS[chain] ?? chain.toUpperCase()} address. Check you pasted the address for the right network.`,
      },
      { status: 400 },
    );
  }

  // Only persist xrpTag for XRP chain wallets
  const tagValue = chain === "xrp" ? xrpTag || null : null;
  const tagChanged = !!existing && existing.xrpTag !== tagValue;

  // Where buyers' money goes changes only with the account's second factor
  // (POST /api/wallets/verification), so a stolen session alone can't redirect
  // payments. Enabling or disabling a saved address needs none.
  if (addressChanged || tagChanged) {
    if (!code) {
      return NextResponse.json(
        { error: "Enter the verification code to confirm this change.", codeRequired: true },
        { status: 403 },
      );
    }
    if (!(await verifyChallenge(merchant.email, code, "WALLET_CHANGE"))) {
      return NextResponse.json(
        { error: "That code is wrong or has expired. Request a new one.", codeRequired: true },
        { status: 400 },
      );
    }
  }

  const wallet = await prisma.wallet.upsert({
    where: {
      merchantId_chain_token: { merchantId: session.user.id, chain, token },
    },
    update: { address, isActive, xrpTag: tagValue },
    create: {
      merchantId: session.user.id,
      chain,
      token,
      address,
      isActive,
      xrpTag: tagValue,
    },
  });

  // A changed address (or XRP destination tag, which picks the account at a
  // shared/exchange address) redirects where buyers' money goes — the first
  // thing a stolen session would do. Tell the owner. Not awaited: a mail
  // outage must not block or fail the save.
  if (addressChanged || tagChanged) {
    const details = [
      { label: "Network", value: `${chain.toUpperCase()} / ${token.toUpperCase()}` },
      { label: "New address", value: maskAddress(address) },
    ];
    if (existing && addressChanged) {
      details.push({ label: "Previous address", value: maskAddress(existing.address) });
    }
    if (tagValue || existing?.xrpTag) {
      details.push({ label: "Destination tag", value: tagValue ?? "(none)" });
    }
    void notifyAccountSecurityChange({
      to: merchant.email,
      merchantName: merchant.name,
      action: existing ? "Receiving wallet changed" : "Receiving wallet added",
      details,
      ip: clientIp(req),
      reviewPath: "/dashboard/wallets",
      role: merchant.role,
    });
  }

  return NextResponse.json(wallet);
}

export async function DELETE(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const deleteSchema = z.object({
    chain: z.string().min(1),
    token: z.string().min(1),
  });

  const rawBody = await req.json().catch(() => ({}));
  const parseResult = deleteSchema.safeParse(rawBody);

  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.format() },
      { status: 400 },
    );
  }

  const { chain: rawChain, token: rawToken } = parseResult.data;
  const chain = rawChain.toLowerCase();
  const token = rawToken.toLowerCase();

  try {
    await prisma.wallet.delete({
      where: {
        merchantId_chain_token: { merchantId: session.user.id, chain, token },
      },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete wallet error:", error);
    return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  }
}
