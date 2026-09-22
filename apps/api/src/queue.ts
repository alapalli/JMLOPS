// ─────────────────────────────────────────────────────────────
// @jml-ops/api — Provisioning Queue Producer
//
// Priority per CLAUDE.md service ports table: LEAVER=10, JOINER=5,
// MOVER=3. Lower number = lower priority in BullMQ's convention
// (1 is highest), so we invert here — see PRIORITY_MAP.
// ─────────────────────────────────────────────────────────────

import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { JmlEventType } from "@jml-ops/shared";

const REDIS_URL = process.env.REDIS_URL ?? `redis://${process.env.REDIS_HOST ?? "localhost"}:6379`;

const connection = new IORedis(REDIS_URL, {
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
  maxRetriesPerRequest: null,
});

export const provisioningQueue = new Queue("provisioning", { connection });

// BullMQ priority: LOWER number = processed FIRST. Our business
// priority is the opposite convention (10 = most urgent), so we
// map business priority to BullMQ priority by inverting it.
const BUSINESS_PRIORITY: Record<JmlEventType, number> = {
  EMERGENCY_LEAVER: 10,
  LEAVER: 10,
  JOINER: 5,
  MOVER: 3,
  ACCESS_REVIEW: 1,
};

function toBullMQPriority(businessPriority: number): number {
  return 11 - businessPriority; // 10 -> 1 (highest), 1 -> 10 (lowest)
}

export interface EnqueueJmlJobParams {
  jobId: string;
  companyId: string;
  eventType: JmlEventType;
  parsedIntent: unknown;
}

export async function enqueueJmlJob(params: EnqueueJmlJobParams): Promise<void> {
  const businessPriority = BUSINESS_PRIORITY[params.eventType];

  await provisioningQueue.add(
    params.eventType,
    {
      jobId: params.jobId,
      companyId: params.companyId,
      eventType: params.eventType,
      parsedIntent: params.parsedIntent,
    },
    {
      jobId: params.jobId,
      priority: toBullMQPriority(businessPriority),
      attempts: 2, // limited retries — see worker/src/index.ts comment on why
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: { age: 60 * 60 * 24 * 7 }, // keep 7 days for debugging
      removeOnFail: false, // never auto-remove failed jobs — audit trail
    }
  );
}
