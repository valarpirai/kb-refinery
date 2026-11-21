-- CreateTable
CREATE TABLE "StageRun" (
    "id" TEXT NOT NULL,
    "jobItemId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StageRun_stage_startedAt_idx" ON "StageRun"("stage", "startedAt");

-- CreateIndex
CREATE INDEX "StageRun_articleId_idx" ON "StageRun"("articleId");

-- AddForeignKey
ALTER TABLE "StageRun" ADD CONSTRAINT "StageRun_jobItemId_fkey" FOREIGN KEY ("jobItemId") REFERENCES "JobItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageRun" ADD CONSTRAINT "StageRun_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
