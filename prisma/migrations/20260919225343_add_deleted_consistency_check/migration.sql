--AddCheckConstraint
ALTER TABLE "Message"
ADD CONSTRAINT message_deleted_fields_consistent
CHECK (("deletedAt" IS NULL) = ("deletedById" IS NULL));

--AddCheckConstraint
ALTER TABLE "Conversation"
ADD CONSTRAINT conversation_deleted_fields_consistent
CHECK (("deletedAt" IS NULL) = ("deletedById" IS NULL));

--AddCheckConstraint
ALTER TABLE "ConversationParticipant"
ADD CONSTRAINT conversation_participant_deleted_fields_consistent
CHECK (("deletedAt" IS NULL) = ("deletedById" IS NULL));
