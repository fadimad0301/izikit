-- CreateTable
CREATE TABLE "Procedure" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "field" TEXT,
    "tagline" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "priceFcfa" INTEGER NOT NULL DEFAULT 5000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Procedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcedureAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcedureAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Procedure_slug_key" ON "Procedure"("slug");

-- CreateIndex
CREATE INDEX "Procedure_slug_idx" ON "Procedure"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProcedureAccess_orderId_key" ON "ProcedureAccess"("orderId");

-- CreateIndex
CREATE INDEX "ProcedureAccess_userId_idx" ON "ProcedureAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcedureAccess_userId_procedureId_key" ON "ProcedureAccess"("userId", "procedureId");

-- AddForeignKey
ALTER TABLE "ProcedureAccess" ADD CONSTRAINT "ProcedureAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureAccess" ADD CONSTRAINT "ProcedureAccess_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureAccess" ADD CONSTRAINT "ProcedureAccess_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
