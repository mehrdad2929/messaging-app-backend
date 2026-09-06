/*
  Warnings:

  - You are about to drop the column `dmuserAId` on the `Dm` table. All the data in the column will be lost.
  - You are about to drop the column `dmuserBId` on the `Dm` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[dmUserAId,dmUserBId]` on the table `Dm` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `dmUserAId` to the `Dm` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dmUserBId` to the `Dm` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Dm" DROP CONSTRAINT "Dm_dmuserAId_fkey";

-- DropForeignKey
ALTER TABLE "Dm" DROP CONSTRAINT "Dm_dmuserBId_fkey";

-- DropIndex
DROP INDEX "Dm_dmuserAId_dmuserBId_key";

-- AlterTable
ALTER TABLE "Dm" DROP COLUMN "dmuserAId",
DROP COLUMN "dmuserBId",
ADD COLUMN     "dmUserAId" INTEGER NOT NULL,
ADD COLUMN     "dmUserBId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Dm_dmUserAId_dmUserBId_key" ON "Dm"("dmUserAId", "dmUserBId");

-- AddForeignKey
ALTER TABLE "Dm" ADD CONSTRAINT "Dm_dmUserAId_fkey" FOREIGN KEY ("dmUserAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dm" ADD CONSTRAINT "Dm_dmUserBId_fkey" FOREIGN KEY ("dmUserBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
