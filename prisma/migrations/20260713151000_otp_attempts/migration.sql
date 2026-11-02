-- The Otp table was historically created via `prisma db push`, so it is absent
-- from migration history. Ensure it exists (reconciles fresh environments)...
CREATE TABLE IF NOT EXISTS "Otp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Otp_pkey" PRIMARY KEY ("id")
);

-- ...and add the new attempts column for databases where Otp already exists.
ALTER TABLE "Otp" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;

-- Verification now looks up the active OTP by (email, type) and compares the
-- code in-app so failed attempts can be counted and capped.
DROP INDEX IF EXISTS "Otp_email_code_idx";
CREATE INDEX IF NOT EXISTS "Otp_email_type_idx" ON "Otp"("email", "type");
