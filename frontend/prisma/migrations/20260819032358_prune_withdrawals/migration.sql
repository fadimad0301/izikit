/*
  Warnings:

  - You are about to drop the column `withdrawalPinHash` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Withdrawal` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Withdrawal" DROP CONSTRAINT "Withdrawal_userId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "withdrawalPinHash";

-- DropTable
DROP TABLE "Withdrawal";
