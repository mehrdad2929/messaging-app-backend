-- CreateTable
CREATE TABLE "Dm" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "conversationId" INTEGER NOT NULL,
    "dmuserAId" INTEGER NOT NULL,
    "dmuserBId" INTEGER NOT NULL,

    CONSTRAINT "Dm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dm_conversationId_key" ON "Dm"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Dm_dmuserAId_dmuserBId_key" ON "Dm"("dmuserAId", "dmuserBId");

-- AddForeignKey
ALTER TABLE "Dm" ADD CONSTRAINT "Dm_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dm" ADD CONSTRAINT "Dm_dmuserAId_fkey" FOREIGN KEY ("dmuserAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dm" ADD CONSTRAINT "Dm_dmuserBId_fkey" FOREIGN KEY ("dmuserBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
