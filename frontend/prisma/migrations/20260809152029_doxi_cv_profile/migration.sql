-- CreateTable
CREATE TABLE "CvProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetCountry" TEXT,
    "targetField" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CvProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CvProfile_userId_key" ON "CvProfile"("userId");

-- AddForeignKey
ALTER TABLE "CvProfile" ADD CONSTRAINT "CvProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
