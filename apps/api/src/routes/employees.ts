// ─────────────────────────────────────────────────────────────
// @jml-ops/api — Employee Routes
//
// GET /api/employees        — list all employees for the company,
//                              with manager name resolved
// GET /api/employees/:id    — single employee detail + their
//                              provisioning job history
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import "../types";
import { prisma } from "@jml-ops/db";

export async function employeeRoutes(app: FastifyInstance) {
  app.get("/api/employees", async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user?.companyId;
    if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

    const employees = await prisma.employee.findMany({
      where: { companyId },
      include: {
        manager: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    });

    return reply.send(
      employees.map((e) => ({
        id: e.id,
        name: e.name,
        email: e.email,
        jobTitle: e.jobTitle,
        department: e.department,
        location: e.location,
        startDate: e.startDate,
        endDate: e.endDate,
        isActive: e.isActive,
        manager: e.manager ? { id: e.manager.id, name: e.manager.name } : null,
      }))
    );
  });

  app.get<{ Params: { id: string } }>(
    "/api/employees/:id",
    async (request, reply) => {
      const companyId = request.user?.companyId;
      if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

      const employee = await prisma.employee.findFirst({
        where: { id: request.params.id, companyId }, // companyId check prevents cross-tenant access
        include: {
          manager: { select: { id: true, name: true, email: true } },
          reports: { select: { id: true, name: true, jobTitle: true } },
        },
      });

      if (!employee) return reply.code(404).send({ error: "Employee not found" });

      const jobs = await prisma.provisioningJob.findMany({
        where: { employeeId: employee.id, companyId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          eventType: true,
          status: true,
          prompt: true,
          createdAt: true,
          completedAt: true,
        },
      });

      return reply.send({
        id: employee.id,
        name: employee.name,
        email: employee.email,
        jobTitle: employee.jobTitle,
        department: employee.department,
        location: employee.location,
        startDate: employee.startDate,
        endDate: employee.endDate,
        isActive: employee.isActive,
        manager: employee.manager,
        reports: employee.reports,
        jobHistory: jobs,
      });
    }
  );
}
