// ─────────────────────────────────────────────────────────────
// @jml-ops/api — JML Routes
//
// POST /api/jml/submit    — user submits a natural-language prompt
// GET  /api/jml/jobs/:id  — poll a single job's status/steps
// GET  /api/jml/jobs      — list recent jobs for the admin screen
// ─────────────────────────────────────────────────────────────

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@jml-ops/db";
import { SubmitPromptRequestSchema, canManageRequests } from "@jml-ops/shared";
import { parsePromptToIntent, deriveProviderFields } from "../litellm-client";
import { enqueueJmlJob } from "../queue";
import { broadcastJobUpdate } from "../websocket";

export async function jmlRoutes(app: FastifyInstance) {
  app.post("/api/jml/submit", async (request: FastifyRequest, reply: FastifyReply) => {
    const companyId = request.user?.companyId;
    if (!companyId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    if (!canManageRequests(request.user.role)) return reply.code(403).send({ error: "Submit requests through My Requests for administrator approval" });

    const parseResult = SubmitPromptRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: parseResult.error.message });
    }
    const { prompt } = parseResult.data;

    const job = await prisma.provisioningJob.create({
      data: {
        companyId,
        eventType: "JOINER",
        status: "PENDING",
        prompt,
        triggeredBy: "prompt",
      },
    });

    broadcastJobUpdate(companyId, {
      type: "job_update",
      jobId: job.id,
      status: "PENDING",
      message: "Request received, parsing intent...",
    });

    const parseIntentResult = await parsePromptToIntent(prompt);
    const { routing } = parseIntentResult;

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
        inputTokens: parseIntentResult.tokensUsed?.input ?? 0,
        outputTokens: parseIntentResult.tokensUsed?.output ?? 0,
        totalTokens:
          (parseIntentResult.tokensUsed?.input ?? 0) + (parseIntentResult.tokensUsed?.output ?? 0),
        durationMs: routing.parseDurationMs,
        error: parseIntentResult.errorMessage ?? null,
      },
    });

    if (!parseIntentResult.success || !parseIntentResult.intent) {
      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMessage: parseIntentResult.errorMessage ?? null },
      });

      broadcastJobUpdate(companyId, {
        type: "job_update",
        jobId: job.id,
        status: "FAILED",
        message: `Could not understand the request: ${parseIntentResult.errorMessage}`,
      });

      return reply.code(200).send({
        jobId: job.id,
        status: "FAILED",
        parsedIntent: null,
        error: parseIntentResult.errorMessage,
      });
    }

    const intent = parseIntentResult.intent;

    if (intent.confidence < 0.7) {
      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: {
          eventType: intent.eventType,
          parsedIntent: intent,
          aiModel: "claude-sonnet-4-6",
          status: "FAILED",
          errorMessage: `Low confidence (${intent.confidence.toFixed(2)}) — held for manual review. Ambiguous: ${intent.ambiguousFields.join(", ") || "none listed"}`,
        },
      });

      broadcastJobUpdate(companyId, {
        type: "job_update",
        jobId: job.id,
        status: "FAILED",
        message: "Low-confidence parse — held for admin review, not executed automatically.",
      });

      return reply.code(200).send({
        jobId: job.id,
        status: "FAILED",
        parsedIntent: intent,
      });
    }

    await prisma.provisioningJob.update({
      where: { id: job.id },
      data: {
        eventType: intent.eventType,
        parsedIntent: intent,
        aiModel: "claude-sonnet-4-6",
      },
    });

    await enqueueJmlJob({
      jobId: job.id,
      companyId,
      eventType: intent.eventType,
      parsedIntent: intent,
    });

    broadcastJobUpdate(companyId, {
      type: "job_update",
      jobId: job.id,
      status: "PENDING",
      message: `Understood as ${intent.eventType} for ${intent.employeeEmail}. Queued for processing.`,
    });

    return reply.code(200).send({
      jobId: job.id,
      status: "PENDING",
      parsedIntent: intent,
    });
  });

  app.get<{ Params: { id: string } }>("/api/jml/jobs/:id", async (request, reply) => {
    const companyId = request.user?.companyId;
    if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

    const job = await prisma.provisioningJob.findFirst({
      where: { id: request.params.id, companyId },
      include: { steps: true },
    });

    if (!job) return reply.code(404).send({ error: "Job not found" });

    return reply.send({
      id: job.id,
      eventType: job.eventType,
      status: job.status,
      prompt: job.prompt,
      parsedIntent: job.parsedIntent,
      totalSteps: job.totalSteps,
      completedSteps: job.completedSteps,
      failedSteps: job.failedSteps,
      steps: job.steps.map((s) => ({
        id: s.id,
        connectorType: s.connectorType,
        action: s.action,
        status: s.status,
        durationMs: s.durationMs,
        errorMessage: s.errorMessage,
      })),
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
      errorMessage: job.errorMessage,
    });
  });

  app.get("/api/jml/jobs", async (request, reply) => {
    const companyId = request.user?.companyId;
    if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

    const jobs = await prisma.provisioningJob.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return reply.send(
      jobs.map((j) => ({
        id: j.id,
        eventType: j.eventType,
        status: j.status,
        prompt: j.prompt,
        createdAt: j.createdAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
      }))
    );
  });
}
