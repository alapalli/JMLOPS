// ─────────────────────────────────────────────────────────────
// @jml-ops/api — Connector Routes
//
// v0.1: read-only status + a test-connection action. Full
// connector CRUD (add/edit credentials via UI) is out of scope
// for this slice — connectors are configured via seed script /
// direct DB access for now, per the locked v0.1 boundary.
// ─────────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import { prisma } from "@jml-ops/db";
import { EntraConnector } from "@jml-ops/connectors";

export async function connectorRoutes(app: FastifyInstance) {
  app.get("/api/connectors", async (request, reply) => {
    const companyId = request.user?.companyId;
    if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

    const connectors = await prisma.connector.findMany({
      where: { companyId },
    });

    return reply.send(
      connectors.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        status: c.status,
        isEnabled: c.isEnabled,
        lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
        lastErrorAt: c.lastErrorAt?.toISOString() ?? null,
        lastError: c.lastError,
        errorCount: c.errorCount,
      }))
    );
  });

  app.post<{ Params: { id: string } }>("/api/connectors/:id/test", async (request, reply) => {
    const companyId = request.user?.companyId;
    if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

    const connector = await prisma.connector.findFirst({
      where: { id: request.params.id, companyId },
    });

    if (!connector) return reply.code(404).send({ error: "Connector not found" });
    if (connector.type !== "ENTRA_ID") {
      return reply.code(400).send({ error: "Test-connection is only implemented for ENTRA_ID in v0.1" });
    }
    if (!connector.config) {
      return reply.code(400).send({ error: "Connector has no configuration set" });
    }

    const config = connector.config as { tenantId: string; clientId: string; clientSecret: string };
    const client = new EntraConnector(config);
    const result = await client.testConnection();

    await prisma.connector.update({
      where: { id: connector.id },
      data: result.success
        ? { status: "ACTIVE", lastSyncAt: new Date(), errorCount: 0 }
        : {
            status: "ERROR",
            lastErrorAt: new Date(),
            lastError: result.errorMessage ?? null,
            errorCount: { increment: 1 },
          },
    });

    return reply.send(result);
  });
}
