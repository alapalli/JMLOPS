// ─────────────────────────────────────────────────────────────
// @jml-ops/api — Change Request Routes
//
// POST /api/requests           — submit a change request (any authenticated user)
// GET  /api/requests           — list requests (own requests for non-admins, all for ADMIN)
// POST /api/requests/:id/approve  — ADMIN only; parses + enqueues the real job
// POST /api/requests/:id/reject   — ADMIN only
//
// Deliberately reuses the SAME parsePromptToIntent + enqueueJmlJob
// path the Prompt Console's /api/jml/submit already uses — approval
// doesn't reimplement provisioning logic, it just gates entry into
// the existing, proven pipeline.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@jml-ops/db";
import { parsePromptToIntent, deriveProviderFields } from "../litellm-client";
import { enqueueJmlJob } from "../queue";
import { broadcastJobUpdate } from "../websocket";

export async function changeRequestRoutes(app: FastifyInstance) {
  app.post("/api/requests", async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user?.companyId;
    const userId = request.user?.userId;
    if (!companyId || !userId) return reply.code(401).send({ error: "Unauthorized" });

    const body = request.body as { prompt?: string; reason?: string };
    if (!body.prompt || body.prompt.trim().length < 3) {
      return reply.code(400).send({ error: "A description of the change is required." });
    }

    const changeRequest = await prisma.changeRequest.create({
      data: {
        companyId,
        requestedById: userId,
        prompt: body.prompt.trim(),
        reason: body.reason?.trim() || null,
      },
    });

    return reply.code(201).send({ id: changeRequest.id, status: changeRequest.status });
  });

  app.get("/api/requests", async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user?.companyId;
    const userId = request.user?.userId;
    const role = request.user?.role;
    if (!companyId || !userId) return reply.code(401).send({ error: "Unauthorized" });

    const isAdmin = role === "ADMIN";

    const requests = await prisma.changeRequest.findMany({
      where: {
        companyId,
        ...(isAdmin ? {} : { requestedById: userId }),
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return reply.send(
      requests.map((r) => ({
        id: r.id,
        prompt: r.prompt,
        reason: r.reason,
        status: r.status,
        requestedBy: r.requestedBy,
        reviewedBy: r.reviewedBy,
        reviewNote: r.reviewNote,
        resultingJobId: r.resultingJobId,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
      }))
    );
  });

  app.post<{ Params: { id: string } }>(
    "/api/requests/:id/approve",
    async (request, reply) => {
      const companyId = request.user?.companyId;
      const userId = request.user?.userId;
      const role = request.user?.role;
      if (!companyId || !userId) return reply.code(401).send({ error: "Unauthorized" });
      if (role !== "ADMIN") return reply.code(403).send({ error: "Only admins can approve change requests." });

      const changeRequest = await prisma.changeRequest.findFirst({
        where: { id: request.params.id, companyId, status: "PENDING" },
      });
      if (!changeRequest) return reply.code(404).send({ error: "Pending request not found." });

      const job = await prisma.provisioningJob.create({
        data: {
          companyId,
          eventType: "JOINER",
          status: "PENDING",
          prompt: changeRequest.prompt,
          triggeredBy: "change_request_approval",
        },
      });

      broadcastJobUpdate(companyId, {
        type: "job_update",
        jobId: job.id,
        status: "PENDING",
        message: "Change request approved — parsing intent...",
      });

      const parseResult = await parsePromptToIntent(changeRequest.prompt);
      const { routing } = parseResult;

      await prisma.aiCall.create({
        data: {
          companyId,
          jobId: job.id,
          ...deriveProviderFields(routing.classifyModel, "jml-classify"),
          task: "classify",
          durationMs: routing.classifyDurationMs,
        },
      });
      await prisma.aiCall.create({
        data: {
          companyId,
          jobId: job.id,
          ...deriveProviderFields(routing.parseServedByModel, routing.parseModelAlias),
          task: routing.routedForSensitivity ? "parse_intent_sensitive" : "parse_intent",
          durationMs: routing.parseDurationMs,
          error: parseResult.errorMessage ?? null,
        },
      });

      if (!parseResult.success || !parseResult.intent) {
        await prisma.provisioningJob.update({
          where: { id: job.id },
          data: { status: "FAILED", errorMessage: parseResult.errorMessage ?? null },
        });
      } else {
        const intent = parseResult.intent;
        await prisma.provisioningJob.update({
          where: { id: job.id },
          data: { eventType: intent.eventType, parsedIntent: intent, aiModel: "claude-sonnet-4-6" },
        });

        if (intent.confidence >= 0.7) {
          await enqueueJmlJob({ jobId: job.id, companyId, eventType: intent.eventType, parsedIntent: intent });
        } else {
          await prisma.provisioningJob.update({
            where: { id: job.id },
            data: { status: "FAILED", errorMessage: `Low confidence (${intent.confidence.toFixed(2)}) — held for manual review.` },
          });
        }
      }

      await prisma.changeRequest.update({
        where: { id: changeRequest.id },
        data: { status: "APPROVED", reviewedById: userId, reviewedAt: new Date(), resultingJobId: job.id },
      });

      return reply.send({ id: changeRequest.id, status: "APPROVED", resultingJobId: job.id });
    }
  );

  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    "/api/requests/:id/reject",
    async (request, reply) => {
      const companyId = request.user?.companyId;
      const userId = request.user?.userId;
      const role = request.user?.role;
      if (!companyId || !userId) return reply.code(401).send({ error: "Unauthorized" });
      if (role !== "ADMIN") return reply.code(403).send({ error: "Only admins can reject change requests." });

      const changeRequest = await prisma.changeRequest.findFirst({
        where: { id: request.params.id, companyId, status: "PENDING" },
      });
      if (!changeRequest) return reply.code(404).send({ error: "Pending request not found." });

      await prisma.changeRequest.update({
        where: { id: changeRequest.id },
        data: {
          status: "REJECTED",
          reviewedById: userId,
          reviewedAt: new Date(),
          reviewNote: request.body?.note?.trim() || null,
        },
      });

      return reply.send({ id: changeRequest.id, status: "REJECTED" });
    }
  );
}
