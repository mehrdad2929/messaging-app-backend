-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing conversations get their newest message time (deleted messages
-- included: deleting the newest message does not rewind activity).
-- Conversations with no messages keep the CURRENT_TIMESTAMP default.
UPDATE "Conversation" c
SET "lastMessageAt" = COALESCE(
    (SELECT MAX(m."createdAt") FROM "Message" m WHERE m."conversationId" = c.id),
    c."lastMessageAt"
);
