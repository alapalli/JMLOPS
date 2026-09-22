// ─────────────────────────────────────────────────────────────
// @jml-ops/api — AI Analytics Routes
//
// Read-only aggregation over the existing AiCall table — this data
// was already being written by every classify/parse call via
// litellm-client.ts's deriveProviderFields() (see that file's
// comments), just never exposed through an API before now. No new
// data collection, no new AI-call logging — purely a new read path
// over what already exists.
// ─────────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import { prisma } from "@jml-ops/db";

export async function analyticsRoutes(app: FastifyInstance) {
  app.get("/api/analytics/summary", async (request, reply) => {
    const companyId = request.user?.companyId;
    if (!companyId) return reply.code(401).send({ error: "Unauthorized" });

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const calls = await prisma.aiCall.findMany({
      where: { companyId, createdAt: { gte: since } },
      select: {
        provider: true,
        model: true,
        isLocal: true,
        task: true,
        costUsd: true,
        durationMs: true,
        createdAt: true,
      },
    });

    const totalCalls = calls.length;
    const cloudCalls = calls.filter((c) => !c.isLocal);
    const localCalls = calls.filter((c) => c.isLocal);
    const totalCostUsd = cloudCalls.reduce((sum, c) => sum + Number(c.costUsd ?? 0), 0);
    const avgDurationMs = totalCalls > 0 ? Math.round(calls.reduce((sum, c) => sum + c.durationMs, 0) / totalCalls) : 0;

    const byModel = new Map<string, { calls: number; costUsd: number; isLocal: boolean }>();
    for (const c of calls) {
      const key = c.model;
      const entry = byModel.get(key) ?? { calls: 0, costUsd: 0, isLocal: c.isLocal };
      entry.calls += 1;
      entry.costUsd += Number(c.costUsd ?? 0);
      byModel.set(key, entry);
    }

    const byTask = new Map<string, { calls: number; totalDurationMs: number; costUsd: number; model: string; isLocal: boolean }>();
    for (const c of calls) {
      const key = c.task;
      const entry = byTask.get(key) ?? { calls: 0, totalDurationMs: 0, costUsd: 0, model: c.model, isLocal: c.isLocal };
      entry.calls += 1;
      entry.totalDurationMs += c.durationMs;
      entry.costUsd += Number(c.costUsd ?? 0);
      byTask.set(key, entry);
    }

    return reply.send({
      periodDays: 30,
      totalCalls,
      cloudCallCount: cloudCalls.length,
      localCallCount: localCalls.length,
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      avgDurationMs,
      byModel: Array.from(byModel.entries()).map(([model, v]) => ({ model, ...v, costUsd: Number(v.costUsd.toFixed(4)) })),
      byTask: Array.from(byTask.entries()).map(([task, v]) => ({
        task,
        calls: v.calls,
        avgDurationMs: Math.round(v.totalDurationMs / v.calls),
        costUsd: Number(v.costUsd.toFixed(4)),
        model: v.model,
        isLocal: v.isLocal,
      })),
    });
  });
}
