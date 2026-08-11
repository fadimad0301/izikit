-- AlterTable
ALTER TABLE "ProcedureAccess" ADD COLUMN     "tier" TEXT NOT NULL DEFAULT 'SIMPLE';

-- CreateTable
CREATE TABLE "ProcedureDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "cloudinaryPublicId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcedureDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcedureDocument_cloudinaryPublicId_key" ON "ProcedureDocument"("cloudinaryPublicId");

-- CreateIndex
CREATE INDEX "ProcedureDocument_userId_procedureId_idx" ON "ProcedureDocument"("userId", "procedureId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcedureDocument_userId_procedureId_checklistItemId_key" ON "ProcedureDocument"("userId", "procedureId", "checklistItemId");

-- AddForeignKey
ALTER TABLE "ProcedureDocument" ADD CONSTRAINT "ProcedureDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureDocument" ADD CONSTRAINT "ProcedureDocument_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
