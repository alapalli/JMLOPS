-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('LAPTOP', 'PHONE', 'BADGE', 'MONITOR', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'RETURNED', 'LOST');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "employeeId" TEXT;

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT,
    "type" "AssetType" NOT NULL,
    "label" TEXT NOT NULL,
    "serialNumber" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "employeeId" TEXT,
    "requestType" TEXT,
    "prompt" TEXT NOT NULL,
    "reason" TEXT,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "resultingJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_companyId_assignedAt_idx" ON "assets"("companyId", "assignedAt");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_resultingJobId_key" ON "change_requests"("resultingJobId");

-- CreateIndex
CREATE INDEX "change_requests_companyId_status_createdAt_idx" ON "change_requests"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "change_requests_companyId_requestedById_idx" ON "change_requests"("companyId", "requestedById");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_companyId_key" ON "users"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_id_companyId_key" ON "employees"("id", "companyId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_requestedById_companyId_fkey" FOREIGN KEY ("requestedById", "companyId") REFERENCES "users"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_reviewedById_companyId_fkey" FOREIGN KEY ("reviewedById", "companyId") REFERENCES "users"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

