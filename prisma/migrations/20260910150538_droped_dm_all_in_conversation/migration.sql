/*
  Warnings:

  - You are about to drop the `Dm` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[dmKey]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('DM', 'GROUPCHAT', 'CHANNEL');

-- DropForeignKey
ALTER TABLE "Dm" DROP CONSTRAINT "Dm_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "Dm" DROP CONSTRAINT "Dm_dmUserAId_fkey";

-- DropForeignKey
ALTER TABLE "Dm" DROP CONSTRAINT "Dm_dmUserBId_fkey";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "conversationType" "ConversationType" NOT NULL DEFAULT 'DM',
ADD COLUMN     "dmKey" TEXT;

-- DropTable
DROP TABLE "Dm";

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_dmKey_key" ON "Conversation"("dmKey");
