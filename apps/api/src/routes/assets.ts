// ─────────────────────────────────────────────────────────────
// @jml-ops/api — Asset Routes
//
// GET  /api/assets              — list all assets for the company
// GET  /api/assets/employee/:id — assets currently/previously assigned to one employee
// POST /api/assets               — assign a new asset (create + assign in one step)
// POST /api/assets/:id/return    — mark an asset returned
//
// Deliberately no speculative imports — apps/api/src/routes/employees.ts
// established the correct pattern earlier tonight (request.user?.companyId
// is available without any extra import); this file follows it exactly.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@jml-ops/db";

export async function assetRoutes(app: FastifyInstance) {
  app.get("/api/assets", async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user?.companyId;
    if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

    const assets = await prisma.asset.findMany({
      where: { companyId },
      include: { employee: { select: { id: true, name: true, email: true } } },
      orderBy: { assignedAt: "desc" },
      take: 200,
    });

    return reply.send(
      assets.map((a) => ({
        id: a.id,
        type: a.type,
        label: a.label,
        serialNumber: a.serialNumber,
        status: a.status,
        assignedAt: a.assignedAt,
        returnedAt: a.returnedAt,
        notes: a.notes,
        employee: a.employee,
      }))
    );
  });

  app.get<{ Params: { id: string } }>(
    "/api/assets/employee/:id",
    async (request, reply) => {
      const companyId = request.user?.companyId;
      if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

      const assets = await prisma.asset.findMany({
        where: { employeeId: request.params.id, companyId },
        orderBy: { assignedAt: "desc" },
      });

      return reply.send(
        assets.map((a) => ({
          id: a.id,
          type: a.type,
          label: a.label,
          serialNumber: a.serialNumber,
          status: a.status,
          assignedAt: a.assignedAt,
          returnedAt: a.returnedAt,
          notes: a.notes,
        }))
      );
    }
  );

  app.post("/api/assets", async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user?.companyId;
    if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

    const body = request.body as {
      employeeId?: string;
      type?: string;
      label?: string;
      serialNumber?: string;
      notes?: string;
    };

    if (!body.type || !body.label) {
      return reply.code(400).send({ error: "Asset type and label are required." });
    }

    const validTypes = ["LAPTOP", "PHONE", "BADGE", "MONITOR", "OTHER"];
    if (!validTypes.includes(body.type)) {
      return reply.code(400).send({ error: `Asset type must be one of: ${validTypes.join(", ")}` });
    }

    const asset = await prisma.asset.create({
      data: {
        companyId,
        employeeId: body.employeeId ?? null,
        type: body.type as never, // validated above against the real enum values
        label: body.label,
        serialNumber: body.serialNumber ?? null,
        notes: body.notes ?? null,
        status: body.employeeId ? "ASSIGNED" : "ASSIGNED",
      },
    });

    return reply.code(201).send({ id: asset.id, status: asset.status });
  });

  app.post<{ Params: { id: string } }>(
    "/api/assets/:id/return",
    async (request, reply) => {
      const companyId = request.user?.companyId;
      if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

      const asset = await prisma.asset.findFirst({
        where: { id: request.params.id, companyId },
      });
      if (!asset) return reply.code(404).send({ error: "Asset not found" });

      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "RETURNED", returnedAt: new Date() },
      });

      return reply.send({ id: asset.id, status: "RETURNED" });
    }
  );
}
