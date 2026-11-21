-- The full system prompt is built when an agent is saved, and stored here. The worker runs this text.
-- Existing agents get their prompt filled by saving them, or by deleting the row and running the seed.
ALTER TABLE "Agent" ADD COLUMN "prompt" TEXT NOT NULL DEFAULT '';
