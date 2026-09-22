// ─────────────────────────────────────────────────────────────
// @jml-ops/api — Employee Self-Service Routes
//
// POST /api/self-service/request  — an employee raises a request about THEMSELVES
// GET  /api/self-service/requests — an employee's own request history
//
// Deliberately reuses the real ChangeRequest model and admin
// approval flow already built (see routes/requests.ts) — this is
// NOT a parallel system. The only real difference from the
// IT-staff-facing /api/requests routes: the prompt is auto-built
// server-side from the requester's OWN linked Employee record
// (via the existing User.employeeId field), so an employee can
// only ever raise a request about themselves — never free-text
// a prompt naming someone else. That's the actual security
// boundary this route exists to enforce.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@jml-ops/db";

const REQUEST_TYPES = ["MOVER_REQUEST", "ACCESS_REQUEST", "LEAVER_REQUEST"] as const;
type RequestType = (typeof REQUEST_TYPES)[number];

export async function selfServiceRoutes(app: FastifyInstance) {
  app.post("/api/self-service/request", async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user?.companyId;
    const userId = request.user?.userId;
    if (!companyId || !userId) return reply.code(401).send({ error: "Unauthorized" });

    // Real security boundary: look up the requester's OWN linked employee
    // record via the existing User.employeeId field. If a user account
    // isn't linked to an employee record, self-service isn't available to
    // them — this is an intentional restriction, not an oversight, since
    // there's no "self" to scope the request to otherwise.
    const user = await prisma.user.findFirst({
      where: { id: userId, companyId },
      include: { employee: true },
    });

    if (!user?.employee) {
      return reply.code(403).send({
        error: "Your account isn't linked to an employee record, so self-service isn't available. Contact your IT admin.",
      });
    }

    const body = request.body as { requestType?: string; details?: string };
    if (!body.requestType || !REQUEST_TYPES.includes(body.requestType as RequestType)) {
      return reply.code(400).send({ error: `requestType must be one of: ${REQUEST_TYPES.join(", ")}` });
    }
    if (!body.details || body.details.trim().length < 3) {
      return reply.code(400).send({ error: "Please describe what you need." });
    }

    // Build the real prompt server-side, anchored to the requester's own
    // verified name/email — the employee only supplies the DETAILS, never
    // the identity being acted on. This is what actually prevents an
    // employee from raising a request about someone else.
    const employee = user.employee;
    const promptPrefix: Record<RequestType, string> = {
      MOVER_REQUEST: `Move ${employee.email} (${employee.name})`,
      ACCESS_REQUEST: `Grant ${employee.email} (${employee.name}) access to`,
      LEAVER_REQUEST: `Offboard ${employee.email} (${employee.name})`,
    };
    const prompt = `${promptPrefix[body.requestType as RequestType]} — ${body.details.trim()}`;

    const changeRequest = await prisma.changeRequest.create({
      data: {
        companyId,
        requestedById: userId,
        prompt,
        reason: `Self-service ${body.requestType.toLowerCase().replace("_", " ")}`,
      },
    });

    return reply.code(201).send({ id: changeRequest.id, status: changeRequest.status });
  });

  app.get("/api/self-service/requests", async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user?.companyId;
    const userId = request.user?.userId;
    if (!companyId || !userId) return reply.code(401).send({ error: "Unauthorized" });

    // Deliberately hard-scoped to the requester's own submissions only —
    // no role check needed here, since requestedById already guarantees
    // an employee can never see anyone else's requests through this route.
    const requests = await prisma.changeRequest.findMany({
      where: { companyId, requestedById: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return reply.send(
      requests.map((r) => ({
        id: r.id,
        prompt: r.prompt,
        status: r.status,
        reviewNote: r.reviewNote,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
      }))
    );
  });
}
