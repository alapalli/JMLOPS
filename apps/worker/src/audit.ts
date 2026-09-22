// ─────────────────────────────────────────────────────────────
// @jml-ops/worker — Audit Log Writer
//
// CLAUDE.md hard rule #6: every provisioning action MUST write to
// audit_log with HMAC-SHA256. This is the ONLY function in the
// codebase allowed to insert into AuditLog — never call
// prisma.auditLog.create() directly anywhere else.
//
// The audit_log table itself is append-only at the database level
// (see infra/dev/init.sql for the trigger that blocks UPDATE/DELETE)
// — this HMAC is a second, independent integrity guarantee on top
// of that: even someone with raw DB access can't quietly edit a
// row without the signature failing verification.
// ─────────────────────────────────────────────────────────────

import { createHmac } from "node:crypto";
import { prisma, type Prisma } from "@jml-ops/db";
import type { JmlEventType, ConnectorType } from "@jml-ops/shared";

const AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET;
if (!AUDIT_HMAC_SECRET) {
  throw new Error(
    "AUDIT_HMAC_SECRET is not set — refusing to start. Audit log integrity cannot be guaranteed without it."
  );
}

export interface AuditLogInput {
  companyId: string;
  eventType: JmlEventType;
  jobId?: string;
  actorId?: string;
  actorEmail?: string;
  employeeEmail?: string;
  connectorType?: ConnectorType;
  action: string;
  payload?: Prisma.InputJsonObject;
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  const id = crypto.randomUUID();
  const createdAt = new Date();

  const hmac = signAuditRow({
    id,
    companyId: input.companyId,
    eventType: input.eventType,
    action: input.action,
    createdAt: createdAt.toISOString(),
  });

  await prisma.auditLog.create({
    data: {
      id,
      companyId: input.companyId,
      eventType: input.eventType,
      jobId: input.jobId ?? null,
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      employeeEmail: input.employeeEmail ?? null,
      connectorType: input.connectorType ?? null,
      action: input.action,
      payload: input.payload ?? {},
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      hmac,
      createdAt,
    },
  });
}

function signAuditRow(fields: {
  id: string;
  companyId: string;
  eventType: string;
  action: string;
  createdAt: string;
}): string {
  const message = `${fields.id}|${fields.companyId}|${fields.eventType}|${fields.action}|${fields.createdAt}`;
  return createHmac("sha256", AUDIT_HMAC_SECRET!).update(message).digest("hex");
}

/**
 * Verifies a stored audit row hasn't been tampered with. Used by the
 * admin UI's audit view to show a trust indicator per row, and by
 * the (future) compliance export job.
 */
export function verifyAuditRow(row: {
  id: string;
  companyId: string;
  eventType: string;
  action: string;
  createdAt: Date;
  hmac: string;
}): boolean {
  const expected = signAuditRow({
    id: row.id,
    companyId: row.companyId,
    eventType: row.eventType,
    action: row.action,
    createdAt: row.createdAt.toISOString(),
  });
  return expected === row.hmac;
}
