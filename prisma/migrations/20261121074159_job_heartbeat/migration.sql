-- AlterTable
ALTER TABLE "JobItem" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claimedBy" TEXT,
ADD COLUMN     "heartbeatAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "JobItem_status_heartbeatAt_idx" ON "JobItem"("status", "heartbeatAt");
