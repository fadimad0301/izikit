-- AlterTable
ALTER TABLE "CvProfile" ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "generatedCv" JSONB;
