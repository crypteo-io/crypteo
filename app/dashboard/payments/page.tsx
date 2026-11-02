import { PaymentsClient } from "@/components/dashboard/PaymentsClient";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { knownUsdValue } from "@/lib/payment/usd-value";
import { Prisma } from "@prisma/client";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Payments",
  description: "Monitor and manage your incoming crypto payments.",
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) return null;

  const sp = await searchParams;
  // ?page=0, ?page=-3 or ?page=abc would give a negative/NaN skip, which
  // Prisma rejects — clamp to a positive integer instead of throwing.
  const parsedPage = Number.parseInt(sp.page || "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const limit = 20;
  const status = sp.status;
  const chain = sp.chain;
  const search = sp.search;

  const where: Prisma.PaymentWhereInput = { merchantId: session.user.id };
  if (status && status !== "all") {
    where.status = { equals: status };
  }
  if (chain && chain !== "all") {
    if (chain === "usdc" || chain === "usdt") {
      where.token = { equals: chain, mode: "insensitive" };
    } else {
      where.chain = { equals: chain, mode: "insensitive" };
    }
  }
  if (search) {
    where.OR = [
      { id: { contains: search, mode: "insensitive" } },
      { customerEmail: { contains: search, mode: "insensitive" } },
      { externalId: { contains: search, mode: "insensitive" } },
    ];
  }

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.payment.count({ where }),
  ]);

  return (
    <PaymentsClient
      key={search ?? ""}
      payments={JSON.parse(JSON.stringify(payments.map((p) => ({ ...p, usdValue: knownUsdValue(p) }))))}
      total={total}
      page={page}
      totalPages={Math.ceil(total / limit)}
    />
  );
}
