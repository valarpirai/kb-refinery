-- Each conversation remembers which agent answers in it. Existing ones use the refinery agent.
ALTER TABLE "Conversation" ADD COLUMN "agentSlug" TEXT NOT NULL DEFAULT 'refinery';
