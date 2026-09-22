-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "JmlEventType" AS ENUM ('JOINER', 'MOVER', 'LEAVER', 'ACCESS_REVIEW', 'EMERGENCY_LEAVER');

-- CreateEnum
CREATE TYPE "JmlJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIALLY_FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('OKTA', 'ENTRA_ID', 'GOOGLE_WORKSPACE', 'SLACK', 'GITHUB', 'GITLAB', 'JIRA', 'JSM', 'SALESFORCE', 'SAP_CIS', 'SAP_SUCCESSFACTORS', 'LINEAR', 'AWS_IAM', 'SENTINEL', 'ONE_PASSWORD', 'FIGMA', 'NOTION', 'ZOOM', 'CUSTOM_SCIM');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('ACTIVE', 'ERROR', 'UNCONFIGURED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('ANTHROPIC', 'OLLAMA', 'OPENAI');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'SCALE', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'IT_MANAGER', 'SECURITY_ANALYST', 'COMPLIANCE_AUDITOR', 'PEOPLE_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
    "logoUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "country" TEXT,
    "dataRegion" TEXT NOT NULL DEFAULT 'eu-central-1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'IT_MANAGER',
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authProvider" "AuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "department" TEXT,
    "jobTitle" TEXT,
    "location" TEXT,
    "managerId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'UNCONFIGURED',
    "config" JSONB,
    "scimEndpoint" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "connectorMap" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provisioning_jobs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT,
    "templateId" TEXT,
    "eventType" "JmlEventType" NOT NULL,
    "status" "JmlJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "prompt" TEXT,
    "parsedIntent" JSONB,
    "aiModel" TEXT,
    "aiCallId" TEXT,
    "totalSteps" INTEGER NOT NULL DEFAULT 0,
    "completedSteps" INTEGER NOT NULL DEFAULT 0,
    "failedSteps" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "triggeredBy" TEXT,
    "jsmTicketKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provisioning_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_steps" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "connectorType" "ConnectorType" NOT NULL,
    "status" "JmlJobStatus" NOT NULL DEFAULT 'PENDING',
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "response" JSONB,
    "durationMs" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "job_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventType" "JmlEventType" NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "employeeId" TEXT,
    "employeeEmail" TEXT,
    "jobId" TEXT,
    "connectorType" "ConnectorType",
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "hmac" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_calls" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "isLocal" BOOLEAN NOT NULL,
    "task" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6),
    "durationMs" INTEGER NOT NULL,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jsm_tickets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT,
    "ticketKey" TEXT NOT NULL,
    "ticketUrl" TEXT,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jsm_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embeddings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "vector" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_domain_key" ON "companies"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE INDEX "companies_domain_idx" ON "companies"("domain");

-- CreateIndex
CREATE INDEX "companies_slug_idx" ON "companies"("slug");

-- CreateIndex
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "users_companyId_email_key" ON "users"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_authProvider_providerAccountId_key" ON "users"("authProvider", "providerAccountId");

-- CreateIndex
CREATE INDEX "employees_companyId_idx" ON "employees"("companyId");

-- CreateIndex
CREATE INDEX "employees_externalId_idx" ON "employees"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_email_key" ON "employees"("companyId", "email");

-- CreateIndex
CREATE INDEX "connectors_companyId_idx" ON "connectors"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "connectors_companyId_type_key" ON "connectors"("companyId", "type");

-- CreateIndex
CREATE INDEX "role_templates_companyId_idx" ON "role_templates"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "role_templates_companyId_name_key" ON "role_templates"("companyId", "name");

-- CreateIndex
CREATE INDEX "provisioning_jobs_companyId_status_idx" ON "provisioning_jobs"("companyId", "status");

-- CreateIndex
CREATE INDEX "provisioning_jobs_companyId_eventType_idx" ON "provisioning_jobs"("companyId", "eventType");

-- CreateIndex
CREATE INDEX "provisioning_jobs_createdAt_idx" ON "provisioning_jobs"("createdAt");

-- CreateIndex
CREATE INDEX "job_steps_jobId_idx" ON "job_steps"("jobId");

-- CreateIndex
CREATE INDEX "audit_log_companyId_eventType_idx" ON "audit_log"("companyId", "eventType");

-- CreateIndex
CREATE INDEX "audit_log_companyId_createdAt_idx" ON "audit_log"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_employeeId_idx" ON "audit_log"("employeeId");

-- CreateIndex
CREATE INDEX "ai_calls_companyId_createdAt_idx" ON "ai_calls"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_calls_model_createdAt_idx" ON "ai_calls"("model", "createdAt");

-- CreateIndex
CREATE INDEX "jsm_tickets_companyId_idx" ON "jsm_tickets"("companyId");

-- CreateIndex
CREATE INDEX "jsm_tickets_jobId_idx" ON "jsm_tickets"("jobId");

-- CreateIndex
CREATE INDEX "embeddings_companyId_sourceType_idx" ON "embeddings"("companyId", "sourceType");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_templates" ADD CONSTRAINT "role_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "role_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "provisioning_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jsm_tickets" ADD CONSTRAINT "jsm_tickets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

