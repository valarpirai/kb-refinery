-- The system prompt is now built from parts on every run. The old single prompt becomes the role.
-- Reseed the agent to get the split rules and tool notes.
ALTER TABLE "Agent" ADD COLUMN "role" TEXT NOT NULL DEFAULT '',
ADD COLUMN "rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "toolNotes" JSONB NOT NULL DEFAULT '{}';

UPDATE "Agent" SET "role" = "systemPrompt";

ALTER TABLE "Agent" DROP COLUMN "systemPrompt";
ALTER TABLE "Agent" ALTER COLUMN "role" DROP DEFAULT;
