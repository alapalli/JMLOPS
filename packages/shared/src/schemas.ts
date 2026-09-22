
import { z } from "zod";

// ── Core enums (mirror Prisma schema — keep in sync manually) ──

export const JmlEventType = z.enum([
  "JOINER",
  "MOVER",
  "LEAVER",
  "ACCESS_REVIEW",
  "EMERGENCY_LEAVER",
]);
export type JmlEventType = z.infer<typeof JmlEventType>;

export const JobStatus = z.enum([
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "PARTIALLY_FAILED",
  "CANCELLED",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const ConnectorType = z.enum([
  "OKTA",
  "ENTRA_ID",
  "GOOGLE_WORKSPACE",
  "SLACK",
  "GITHUB",
  "GITLAB",
  "JIRA",
  "JSM",
  "SALESFORCE",
  "SAP_CIS",
  "SAP_SUCCESSFACTORS",
  "LINEAR",
  "AWS_IAM",
  "SENTINEL",
  "ONE_PASSWORD",
  "FIGMA",
  "NOTION",
  "ZOOM",
  "CUSTOM_SCIM",
]);
export type ConnectorType = z.infer<typeof ConnectorType>;

// ── The AI-parsed intent ────────────────────────────────────────
//
// This is what the LLM (Claude Sonnet or local Qwen/Mistral) must
// return, validated with .safeParse() before any provisioning action
// is allowed to run. If this fails validation, the job is marked
// FAILED with the raw AI output attached for debugging — it is
// NEVER partially trusted.

export const JoinerDetailsSchema = z.object({
  jobTitle: z.string().min(1).optional(),
  department: z.string().min(1).optional(),
  managerEmail: z.string().email().optional(),
  startDate: z.string().datetime().optional(),
  location: z.string().optional(),
  roleTemplateName: z.string().optional(), // e.g. "Backend Engineer"
});
export type JoinerDetails = z.infer<typeof JoinerDetailsSchema>;

export const MoverDetailsSchema = z.object({
  newDepartment: z.string().min(1).optional(),
  newJobTitle: z.string().min(1).optional(),
  newManagerEmail: z.string().email().optional(),
  groupsToAdd: z.array(z.string()).default([]),
  groupsToRemove: z.array(z.string()).default([]),
  effectiveDate: z.string().datetime().optional(),
});
export type MoverDetails = z.infer<typeof MoverDetailsSchema>;

export const LeaverDetailsSchema = z.object({
  lastDay: z.string().datetime().optional(),
  isEmergency: z.boolean().default(false),
  reason: z.string().optional(),
  dataHandoverToEmail: z.string().email().optional(),
});
export type LeaverDetails = z.infer<typeof LeaverDetailsSchema>;

// ─────────────────────────────────────────────────────────────
// FIX: Every field on Joiner/Mover/LeaverDetailsSchema is optional,
// which means it's completely legitimate for the AI to have nothing
// extra to structure (e.g. "onboard jane@co.com as an engineer" with
// no explicit department/manager/start date mentioned). In that case
// Claude may reasonably omit the sub-object entirely or return null,
// per the "Omit the others entirely" instruction in litellm-client.ts
// — but the OLD .refine() below used `!!data.joiner`, which rejects
// both `undefined` and `null` as "missing", incorrectly failing
// validation for a perfectly valid low-detail request.
//
// The fix: preprocess the raw object BEFORE validation, and default
// a missing/null sub-object (for the eventType that needs one) to
// {} — an empty object still satisfies all the optional fields
// inside JoinerDetailsSchema/etc., and the .refine() check below
// now looks for object PRESENCE only, which normalization guarantees.
// ─────────────────────────────────────────────────────────────
export const ProvisioningIntentSchema = z
  .preprocess((raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const data = raw as Record<string, unknown>;
    const eventType = data.eventType;

    if (eventType === "JOINER" && (data.joiner === undefined || data.joiner === null)) {
      return { ...data, joiner: {} };
    }
    if (eventType === "MOVER" && (data.mover === undefined || data.mover === null)) {
      return { ...data, mover: {} };
    }
    if (
      (eventType === "LEAVER" || eventType === "EMERGENCY_LEAVER") &&
      (data.leaver === undefined || data.leaver === null)
    ) {
      return { ...data, leaver: {} };
    }
    return data;
  }, z.object({
    eventType: JmlEventType,
    employeeEmail: z.string().email(),
    employeeName: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),

    // Exactly one of these should be populated based on eventType —
    // validated further in the .refine() below. After the preprocess
    // step above, the matching field is guaranteed to be present
    // (at minimum as {}) for whichever eventType was returned.
    joiner: JoinerDetailsSchema.optional(),
    mover: MoverDetailsSchema.optional(),
    leaver: LeaverDetailsSchema.optional(),

    // Raw fields the AI wasn't confident enough to structure —
    // surfaced to the admin UI for manual review, never silently dropped.
    ambiguousFields: z.array(z.string()).default([]),
  }))
  .refine(
    (data) => {
      if (data.eventType === "JOINER") return !!data.joiner;
      if (data.eventType === "MOVER") return !!data.mover;
      if (data.eventType === "LEAVER" || data.eventType === "EMERGENCY_LEAVER") return !!data.leaver;
      return true; // ACCESS_REVIEW has no sub-details
    },
    { message: "Details object must match eventType (joiner/mover/leaver)" }
  );
export type ProvisioningIntent = z.infer<typeof ProvisioningIntentSchema>;

// ── API request/response contracts ──────────────────────────────

export const SubmitPromptRequestSchema = z.object({
  prompt: z.string().min(3).max(2000),
});
export type SubmitPromptRequest = z.infer<typeof SubmitPromptRequestSchema>;

export const SubmitPromptResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: JobStatus,
  parsedIntent: ProvisioningIntentSchema.nullable(),
});
export type SubmitPromptResponse = z.infer<typeof SubmitPromptResponseSchema>;

export const JobStepResultSchema = z.object({
  id: z.string().uuid(),
  connectorType: ConnectorType,
  action: z.string(),
  status: JobStatus,
  durationMs: z.number().nullable(),
  errorMessage: z.string().nullable(),
});
export type JobStepResult = z.infer<typeof JobStepResultSchema>;

export const JobDetailResponseSchema = z.object({
  id: z.string().uuid(),
  eventType: JmlEventType,
  status: JobStatus,
  prompt: z.string().nullable(),
  parsedIntent: ProvisioningIntentSchema.nullable(),
  totalSteps: z.number(),
  completedSteps: z.number(),
  failedSteps: z.number(),
  steps: z.array(JobStepResultSchema),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
});
export type JobDetailResponse = z.infer<typeof JobDetailResponseSchema>;

// ── WebSocket event contract (job status streaming) ─────────────

export const JobUpdateEventSchema = z.object({
  type: z.literal("job_update"),
  jobId: z.string().uuid(),
  status: JobStatus,
  step: JobStepResultSchema.optional(),
  message: z.string(),
});
export type JobUpdateEvent = z.infer<typeof JobUpdateEventSchema>;


export const AssetInputSchema = z.object({
  employeeId: z.string().uuid().optional(),
  type: z.enum(["LAPTOP", "PHONE", "BADGE", "MONITOR", "OTHER"]),
  label: z.string().trim().min(2).max(200),
  serialNumber: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export const ChangeRequestInputSchema = SubmitPromptRequestSchema.extend({
  reason: z.string().trim().max(2000).optional(),
});
export const ReviewRequestSchema = z.object({ note: z.string().trim().max(2000).optional() });
export const SelfServiceInputSchema = z.object({
  requestType: z.enum(["MOVER_REQUEST", "ACCESS_REQUEST", "LEAVER_REQUEST"]),
  details: z.string().trim().min(3).max(1500),
});
export const EmployeeLinkSchema = z.object({ employeeId: z.string().uuid().nullable() });
export function canManageRequests(role: string): boolean {
  return ["OWNER", "ADMIN", "IT_MANAGER"].includes(role);
}
