import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  if (process.env.NODE_ENV === "production") {
    const base = process.env.DATABASE_URL ?? "";
    const sep = base.includes("?") ? "&" : "?";
    return new PrismaClient({
      datasources: {
        db: { url: `${base}${sep}connection_limit=10&pool_timeout=20` },
      },
    });
  }
  return new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
