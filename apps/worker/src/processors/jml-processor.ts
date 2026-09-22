// ─────────────────────────────────────────────────────────────
// @jml-ops/worker — JML Lifecycle Processor
//
// This is where CLAUDE.md's hard rules become actual enforced
// control flow, not just documentation:
//
//   #4 — Okta/Entra MUST be suspended FIRST in all LEAVER flows,
//        then wait 2s before any other step
//   #6 — Every provisioning action MUST write to audit_log
//        with HMAC-SHA256
//   #7 — LEAVER revocation order: IdP → GitHub/AWS → Salesforce
//        → Slack → others → Sentinel
//        (v0.1 only implements the IdP/Entra portion of this
//        chain — other connectors are stubs for now, see below)
// ─────────────────────────────────────────────────────────────

import type { Job } from "bullmq";
import { EntraConnector, type EntraConnectorResult } from "@jml-ops/connectors";
import { ProvisioningIntentSchema, type ProvisioningIntent } from "@jml-ops/shared";
import { prisma, Prisma } from "@jml-ops/db";
import { writeAuditLog } from "../audit";
import { randomBytes } from "node:crypto";

export interface JmlJobData {
  jobId: string;
  companyId: string;
  eventType: string;
  parsedIntent: unknown; // validated with ProvisioningIntentSchema below — never trust the queue payload's shape
}

const LEAVER_SUSPEND_WAIT_MS = 2000;

/**
 * Entry point called by the BullMQ worker for every job in the
 * "provisioning" queue. Never called directly by API routes —
 * only ever reached via the queue, so retries/backoff are free.
 */
export async function processJmlJob(job: Job<JmlJobData>): Promise<void> {
  const { jobId, companyId } = job.data;

  // Re-validate the intent against the shared schema — the queue
  // payload is untrusted input even though it came from our own API,
  // because a schema drift between api/ and worker/ must fail loud,
  // not silently corrupt a provisioning action.
  const parseResult = ProvisioningIntentSchema.safeParse(job.data.parsedIntent);
  if (!parseResult.success) {
    await failJob(jobId, `Intent validation failed: ${parseResult.error.message}`);
    throw new Error(`Invalid ProvisioningIntent for job ${jobId}`);
  }
  const intent = parseResult.data;

  await prisma.provisioningJob.update({
    where: { id: jobId },
    data: { status: "PROCESSING", startedAt: new Date() },
  });

  const connector = await getEntraConnectorForCompany(companyId);
  if (!connector) {
    await failJob(jobId, "No active ENTRA_ID connector configured for this company");
    return;
  }

  try {
    switch (intent.eventType) {
      case "JOINER":
        await handleJoiner(jobId, companyId, intent, connector);
        break;
      case "MOVER":
        await handleMover(jobId, companyId, intent, connector);
        break;
      case "LEAVER":
      case "EMERGENCY_LEAVER":
        await handleLeaver(jobId, companyId, intent, connector);
        break;
      case "ACCESS_REVIEW":
        // v0.1 does not implement access review execution — the
        // AI can classify it, but there is no automated action yet.
        await failJob(jobId, "ACCESS_REVIEW execution is not implemented in v0.1");
        return;
    }

    await finalizeJob(jobId);
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err; // let BullMQ apply its retry/backoff policy
  }
}

// ── JOINER ─────────────────────────────────────────────────────

async function handleJoiner(
  jobId: string,
  companyId: string,
  intent: ProvisioningIntent,
  connector: EntraConnector
) {
  const nameParts = (intent.employeeName ?? intent.employeeEmail.split("@")[0] ?? "Unknown User").split(" ");
  const firstName = nameParts[0] ?? "Unknown";
  const lastName = nameParts.slice(1).join(" ") || "—";
  const temporaryPassword = generateTemporaryPassword();

  const createResult = await connector.createUser({
    email: intent.employeeEmail,
    displayName: intent.employeeName ?? intent.employeeEmail,
    givenName: firstName,
    surname: lastName,
    ...(intent.joiner?.department ? { department: intent.joiner.department } : {}),
    ...(intent.joiner?.jobTitle ? { jobTitle: intent.joiner.jobTitle } : {}),
    temporaryPassword,
  });

  await recordStep(jobId, "ENTRA_ID", createResult);

  if (!createResult.success || !createResult.entraObjectId) {
    throw new Error(`Entra user creation failed: ${createResult.errorMessage}`);
  }

  await writeAuditLog({
    companyId,
    eventType: "JOINER",
    jobId,
    employeeEmail: intent.employeeEmail,
    connectorType: "ENTRA_ID",
    action: `Created Entra user for ${intent.employeeEmail}`,
    payload: { entraObjectId: createResult.entraObjectId, temporaryPasswordIssued: true },
  });

  // Group assignment from role template, if the AI resolved one.
  // v0.1: group object IDs are looked up from RoleTemplate.connectorMap
  // in Prisma — see packages/db for that lookup helper.
}

// ── MOVER ──────────────────────────────────────────────────────

async function handleMover(
  jobId: string,
  companyId: string,
  intent: ProvisioningIntent,
  connector: EntraConnector
) {
  const lookup = await connector.findUserByEmail(intent.employeeEmail);
  await recordStep(jobId, "ENTRA_ID", lookup);

  if (!lookup.success || !lookup.entraObjectId) {
    throw new Error(`Could not find Entra user for ${intent.employeeEmail}`);
  }
  const userObjectId = lookup.entraObjectId;

  if (intent.mover?.newDepartment || intent.mover?.newJobTitle) {
    const updateResult = await connector.updateUserProfile(userObjectId, {
      ...(intent.mover?.newDepartment ? { department: intent.mover.newDepartment } : {}),
      ...(intent.mover?.newJobTitle ? { jobTitle: intent.mover.newJobTitle } : {}),
    });
    await recordStep(jobId, "ENTRA_ID", updateResult);
  }

  for (const groupId of intent.mover?.groupsToRemove ?? []) {
    const result = await connector.removeFromGroup(userObjectId, groupId);
    await recordStep(jobId, "ENTRA_ID", result);
  }

  for (const groupId of intent.mover?.groupsToAdd ?? []) {
    const result = await connector.addToGroup(userObjectId, groupId);
    await recordStep(jobId, "ENTRA_ID", result);
  }

  await writeAuditLog({
    companyId,
    eventType: "MOVER",
    jobId,
    employeeEmail: intent.employeeEmail,
    connectorType: "ENTRA_ID",
    action: `Updated Entra profile/groups for ${intent.employeeEmail}`,
    payload: {
      newDepartment: intent.mover?.newDepartment,
      groupsAdded: intent.mover?.groupsToAdd,
      groupsRemoved: intent.mover?.groupsToRemove,
    },
  });
}

// ── LEAVER — hard rule enforcement lives here ──────────────────

async function handleLeaver(
  jobId: string,
  companyId: string,
  intent: ProvisioningIntent,
  connector: EntraConnector
) {
  const lookup = await connector.findUserByEmail(intent.employeeEmail);
  await recordStep(jobId, "ENTRA_ID", lookup);

  if (!lookup.success || !lookup.entraObjectId) {
    throw new Error(`Could not find Entra user for ${intent.employeeEmail}`);
  }
  const userObjectId = lookup.entraObjectId;

  // ── STEP 1 (MANDATORY FIRST): suspend + revoke sessions ──
  // This is CLAUDE.md hard rule #4. Do not reorder this.
  const suspendResult = await connector.suspendUser(userObjectId);
  await recordStep(jobId, "ENTRA_ID", suspendResult);

  await writeAuditLog({
    companyId,
    eventType: intent.eventType, // LEAVER or EMERGENCY_LEAVER
    jobId,
    employeeEmail: intent.employeeEmail,
    connectorType: "ENTRA_ID",
    action: `Suspended Entra account + revoked sessions for ${intent.employeeEmail}`,
    payload: { entraObjectId: userObjectId, step: "suspend", isEmergency: intent.leaver?.isEmergency },
  });

  if (!suspendResult.success) {
    // Suspension failing is the single most severe failure mode in
    // this entire system — a departing employee may retain access.
    // Escalate loudly rather than continuing to "best effort" cleanup.
    throw new Error(
      `CRITICAL: Entra suspension failed for ${intent.employeeEmail} — ${suspendResult.errorMessage}. Manual intervention required immediately.`
    );
  }

  // ── STEP 2 (MANDATORY WAIT): let suspension propagate ──
  await new Promise((resolve) => setTimeout(resolve, LEAVER_SUSPEND_WAIT_MS));

  // ── STEP 3: cleanup — group removal, then soft-delete ──
  const groupsResult = await connector.removeAllGroups(userObjectId);
  await recordStep(jobId, "ENTRA_ID", groupsResult);

  const deleteResult = await connector.deleteUser(userObjectId);
  await recordStep(jobId, "ENTRA_ID", deleteResult);

  await writeAuditLog({
    companyId,
    eventType: intent.eventType,
    jobId,
    employeeEmail: intent.employeeEmail,
    connectorType: "ENTRA_ID",
    action: `Completed offboarding cleanup for ${intent.employeeEmail}`,
    payload: {
      entraObjectId: userObjectId,
      step: "cleanup",
      groupsRemoved: groupsResult.success,
      accountDeleted: deleteResult.success,
    },
  });

  // NOTE v0.1 scope: GitHub/AWS/Salesforce/Slack/Sentinel revocation
  // (CLAUDE.md rule #7's full chain) is intentionally NOT implemented
  // yet — only the Entra/IdP portion. This is the correct FIRST slice
  // to ship because it's the step that blocks everything downstream
  // in a real SSO-federated environment; the rest is next.
}

// ── Shared helpers ───────────────────────────────────────────────

async function recordStep(
  jobId: string,
  connectorType: "ENTRA_ID",
  result: EntraConnectorResult
) {
  const connector = await prisma.connector.findFirst({
    where: { type: connectorType },
  });

  await prisma.jobStep.create({
    data: {
      jobId,
      connectorId: connector?.id ?? "unknown",
      connectorType,
      status: result.success ? "COMPLETED" : "FAILED",
      action: result.action,
      payload: {},
      response:
        result.response == null ? Prisma.JsonNull : (result.response as Prisma.InputJsonValue),
      durationMs: result.durationMs,
      errorMessage: result.errorMessage ?? null,
      completedAt: new Date(),
    },
  });

  await prisma.provisioningJob.update({
    where: { id: jobId },
    data: result.success
      ? { completedSteps: { increment: 1 }, totalSteps: { increment: 1 } }
      : { failedSteps: { increment: 1 }, totalSteps: { increment: 1 } },
  });
}

async function finalizeJob(jobId: string) {
  const job = await prisma.provisioningJob.findUniqueOrThrow({ where: { id: jobId } });
  const status = job.failedSteps > 0 ? "PARTIALLY_FAILED" : "COMPLETED";

  await prisma.provisioningJob.update({
    where: { id: jobId },
    data: { status, completedAt: new Date() },
  });
}

async function failJob(jobId: string, errorMessage: string) {
  await prisma.provisioningJob.update({
    where: { id: jobId },
    data: { status: "FAILED", errorMessage, completedAt: new Date() },
  });
}

async function getEntraConnectorForCompany(companyId: string): Promise<EntraConnector | null> {
  const record = await prisma.connector.findUnique({
    where: { companyId_type: { companyId, type: "ENTRA_ID" } },
  });

  if (!record || !record.isEnabled || record.status !== "ACTIVE" || !record.config) {
    return null;
  }

  const config = record.config as { tenantId: string; clientId: string; clientSecret: string };
  return new EntraConnector(config);
}

function generateTemporaryPassword(): string {
  // Meets standard Entra complexity requirements: length + mixed charset.
  const raw = randomBytes(12).toString("base64").replace(/[^a-zA-Z0-9]/g, "");
  return `Jml${raw.slice(0, 10)}!9`;
}
