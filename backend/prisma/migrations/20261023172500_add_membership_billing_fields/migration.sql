-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "billingAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "billingCycleDate" TIMESTAMP(3);
