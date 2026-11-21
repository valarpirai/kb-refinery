-- Vector search needs the pgvector extension.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "ChunkVariant" AS ENUM ('original', 'refined');

-- CreateEnum
CREATE TYPE "ArmStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('original', 'refined', 'tie', 'neither');

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "variant" "ChunkVariant" NOT NULL,
    "ord" INTEGER NOT NULL,
    "heading" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comparison" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "verdict" "Verdict",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparisonArm" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "variant" "ChunkVariant" NOT NULL,
    "status" "ArmStatus" NOT NULL DEFAULT 'pending',
    "answer" TEXT,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "latencyMs" INTEGER,
    "error" TEXT,
    "judge" JSONB,

    CONSTRAINT "ComparisonArm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Chunk_variant_idx" ON "Chunk"("variant");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_articleId_variant_ord_key" ON "Chunk"("articleId", "variant", "ord");

-- CreateIndex
CREATE UNIQUE INDEX "ComparisonArm_comparisonId_variant_key" ON "ComparisonArm"("comparisonId", "variant");

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonArm" ADD CONSTRAINT "ComparisonArm_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "Comparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;
