// ─────────────────────────────────────────────────────────────
// @jml-ops/worker — Entry Point
//
// Boots the BullMQ Worker that consumes the "provisioning" queue.
// Priority is enforced by the queue producer (apps/api), not here:
// LEAVER=10, JOINER=5, MOVER=3 per CLAUDE.md service ports table.
// ─────────────────────────────────────────────────────────────

import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { processJmlJob, type JmlJobData } from "./processors/jml-processor";

const REDIS_URL = process.env.REDIS_URL ?? `redis://${process.env.REDIS_HOST ?? "localhost"}:6379`;

const connection = new IORedis(REDIS_URL, {
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
  maxRetriesPerRequest: null, // required by BullMQ
});

const worker = new Worker<JmlJobData>(
  "provisioning",
  async (job: Job<JmlJobData>) => {
    console.log(`[worker] Processing job ${job.id} (${job.data.eventType}) for company ${job.data.companyId}`);
    await processJmlJob(job);
    console.log(`[worker] Completed job ${job.id}`);
  },
  {
    connection,
    concurrency: 5,
    // Retries: JML actions are NOT automatically safe to retry blindly
    // (e.g. re-running createUser could error on duplicate, which is
    // actually fine — Entra will reject it cleanly). We allow BullMQ's
    // default backoff but cap attempts low since a human should look
    // at repeated provisioning failures rather than silently retrying
    // forever against a live identity provider.
  }
);

worker.on("failed", (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);
});

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} marked complete`);
});

worker.on("error", (err) => {
  console.error("[worker] Worker-level error:", err);
});

console.log("[worker] JML Ops worker started, listening on queue 'provisioning'");

process.on("SIGTERM", async () => {
  console.log("[worker] SIGTERM received, closing gracefully...");
  await worker.close();
  process.exit(0);
});
