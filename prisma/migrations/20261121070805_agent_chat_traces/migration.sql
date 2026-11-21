/*
  Warnings:

  - You are about to drop the `AgentRun` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AgentStep` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('pending', 'streaming', 'completed', 'failed');

-- DropForeignKey
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_importRunId_fkey";

-- DropForeignKey
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_jobId_fkey";

-- DropForeignKey
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_userId_fkey";

-- DropForeignKey
ALTER TABLE "AgentStep" DROP CONSTRAINT "AgentStep_runId_fkey";

-- DropTable
DROP TABLE "AgentRun";

-- DropTable
DROP TABLE "AgentStep";

-- DropEnum
DROP TYPE "AgentStatus";

-- DropEnum
DROP TYPE "AgentStepStatus";

-- DropEnum
DROP TYPE "AgentTrigger";

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" "MessageStatus" NOT NULL DEFAULT 'completed',
    "toolCalls" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceSpan" (
    "spanId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceSpan_pkey" PRIMARY KEY ("spanId")
);

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "TraceSpan_traceId_startedAt_idx" ON "TraceSpan"("traceId", "startedAt");

-- CreateIndex
CREATE INDEX "TraceSpan_startedAt_idx" ON "TraceSpan"("startedAt");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
