-- Keyword search over chunk text. An expression index, so no column is added and Prisma needs no model change.
CREATE INDEX "Chunk_content_fts_idx" ON "Chunk" USING GIN (to_tsvector('english', "content"));
