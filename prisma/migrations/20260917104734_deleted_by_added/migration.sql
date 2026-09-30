-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "deletedById" INTEGER;

-- AlterTable
ALTER TABLE "ConversationParticipant" ADD COLUMN     "deletedById" INTEGER;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" INTEGER;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
