-- CreateEnum
CREATE TYPE "TargetAudience" AS ENUM ('end_user', 'admin', 'developer', 'mixed');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('ingested', 'analyzing', 'restructuring', 'validating', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "SnapshotType" AS ENUM ('raw', 'converted', 'enriched');

-- CreateEnum
CREATE TYPE "FindingType" AS ENUM ('outdated', 'incomplete', 'image_dependent', 'no_resolution_steps', 'too_vague', 'audience_mismatch', 'missing_prerequisites', 'no_error_guidance', 'missing_context', 'unlinked_product', 'broken_link', 'duplicate');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "FindingState" AS ENUM ('new', 'acknowledged', 'remediated', 'cancelled');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('internal', 'external', 'vendor', 'platform');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'completed', 'completed_with_errors', 'failed');

-- CreateEnum
CREATE TYPE "JobItemStatus" AS ENUM ('pending', 'converting', 'analyzing', 'enriching', 'scoring', 'completed', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('md', 'html', 'csv', 'json', 'text');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'running', 'completed', 'completed_with_errors', 'failed');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('rest_json', 'url_crawl');

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "cron" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" "ImportStatus",
    "lastMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT,
    "label" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "format" "ContentFormat" NOT NULL DEFAULT 'md',
    "knowledgeBase" TEXT,
    "url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sourceUpdatedAt" TIMESTAMP(3),
    "dataSourceId" TEXT,
    "importRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "resolution" TEXT NOT NULL DEFAULT '',
    "category" TEXT,
    "openedAt" TIMESTAMP(3),
    "importRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "standardizedSummary" TEXT,
    "searchTerms" JSONB NOT NULL DEFAULT '[]',
    "targetAudience" "TargetAudience",
    "pipelineStage" "PipelineStage" NOT NULL DEFAULT 'ingested',
    "enrichmentConfidence" "Confidence",
    "enrichmentKnowledge" JSONB,
    "lastJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "type" "SnapshotType" NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "score" INTEGER,
    "llmScore" INTEGER,
    "wordCount" INTEGER,
    "tokenCount" INTEGER,
    "imageCount" INTEGER,
    "linkCount" INTEGER,
    "brokenLinkCount" INTEGER,
    "processingMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "lastJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "type" "FindingType" NOT NULL,
    "severity" "Severity",
    "detail" TEXT,
    "state" "FindingState" NOT NULL DEFAULT 'new',
    "relatedAnalysisId" TEXT,
    "recommendedPrimaryId" TEXT,
    "brokenUrl" TEXT,
    "lastJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "newInformation" TEXT,
    "contradictsArticle" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '',
    "type" "ProductType",
    "articleCount" INTEGER NOT NULL DEFAULT 0,
    "dedicatedAnalysisId" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mention" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mentionCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "articlesTotal" INTEGER NOT NULL DEFAULT 0,
    "articlesProcessed" INTEGER NOT NULL DEFAULT 0,
    "articlesSkipped" INTEGER NOT NULL DEFAULT 0,
    "findingsGenerated" INTEGER NOT NULL DEFAULT 0,
    "duplicatesFound" INTEGER NOT NULL DEFAULT 0,
    "brokenLinksFound" INTEGER NOT NULL DEFAULT 0,
    "remainingBatches" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "analysisId" TEXT,
    "status" "JobItemStatus" NOT NULL DEFAULT 'pending',
    "batchNumber" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Article_knowledgeBase_idx" ON "Article"("knowledgeBase");

-- CreateIndex
CREATE UNIQUE INDEX "Article_dataSourceId_externalId_key" ON "Article"("dataSourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_number_key" ON "Incident"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_articleId_key" ON "Analysis"("articleId");

-- CreateIndex
CREATE INDEX "Analysis_pipelineStage_idx" ON "Analysis"("pipelineStage");

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_analysisId_version_type_key" ON "Snapshot"("analysisId", "version", "type");

-- CreateIndex
CREATE INDEX "Finding_analysisId_state_idx" ON "Finding"("analysisId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_findingId_incidentId_key" ON "Evidence"("findingId", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_name_key" ON "Product"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Mention_analysisId_productId_key" ON "Mention"("analysisId", "productId");

-- CreateIndex
CREATE INDEX "JobItem_jobId_status_idx" ON "JobItem"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobItem_jobId_articleId_key" ON "JobItem"("jobId", "articleId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_name_key" ON "PromptTemplate"("name");

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_lastJobId_fkey" FOREIGN KEY ("lastJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_lastJobId_fkey" FOREIGN KEY ("lastJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_relatedAnalysisId_fkey" FOREIGN KEY ("relatedAnalysisId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_recommendedPrimaryId_fkey" FOREIGN KEY ("recommendedPrimaryId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_lastJobId_fkey" FOREIGN KEY ("lastJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_dedicatedAnalysisId_fkey" FOREIGN KEY ("dedicatedAnalysisId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobItem" ADD CONSTRAINT "JobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobItem" ADD CONSTRAINT "JobItem_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobItem" ADD CONSTRAINT "JobItem_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
