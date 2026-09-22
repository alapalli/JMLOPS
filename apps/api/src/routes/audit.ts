// ─────────────────────────────────────────────────────────────
// @jml-ops/api — Audit Log Routes
//
// Read-only by design — there is deliberately no PATCH/DELETE
// route here. The audit_log table is append-only at the DB level
// (see infra/dev/init.sql trigger) and this API layer doesn't even
// expose a way to attempt a mutation.
// ─────────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import { prisma } from "@jml-ops/db";
import { createHmac } from "node:crypto";

const AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET;

export async function auditRoutes(app: FastifyInstance) {
  app.get("/api/audit", async (request, reply) => {
    const companyId = request.user?.companyId;
    if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

    const query = request.query as { eventType?: string; limit?: string };
    const limit = Math.min(parseInt(query.limit ?? "100", 10), 500);

    const rows = await prisma.auditLog.findMany({
      where: {
        companyId,
        ...(query.eventType ? { eventType: query.eventType as any } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return reply.send(
      rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        actorEmail: row.actorEmail,
        employeeEmail: row.employeeEmail,
        jobId: row.jobId,
        connectorType: row.connectorType,
        action: row.action,
        createdAt: row.createdAt.toISOString(),
        verified: AUDIT_HMAC_SECRET ? verifyRow(row, AUDIT_HMAC_SECRET) : null,
      }))
    );
  });
}

function verifyRow(
  row: { id: string; companyId: string; eventType: string; action: string; createdAt: Date; hmac: string },
  secret: string
): boolean {
  const message = `${row.id}|${row.companyId}|${row.eventType}|${row.action}|${row.createdAt.toISOString()}`;
  const expected = createHmac("sha256", secret).update(message).digest("hex");
  return expected === row.hmac;
}
