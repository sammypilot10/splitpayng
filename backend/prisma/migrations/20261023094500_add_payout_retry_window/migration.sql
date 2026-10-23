-- AlterTable
ALTER TABLE "Payout" ADD COLUMN "firstAttemptAt" TIMESTAMP(3),
ADD COLUMN "lastShortfallAlertAt" TIMESTAMP(3);
