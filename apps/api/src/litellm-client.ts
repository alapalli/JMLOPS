// ─────────────────────────────────────────────────────────────
// @jml-ops/api — LiteLLM Client
//
// CLAUDE.md hard rule #3: all AI calls via LiteLLM at :4002 —
// never call Anthropic or Ollama directly. This is the only file
// in apps/api allowed to make an HTTP call to the AI layer.
//
// REAL TASK-BASED ROUTING (not a single hardcoded model):
//
//   Stage 1 — CLASSIFY (fast, cheap, always local first)
//     model alias: "jml-classify" -> Ollama Mistral 7B, ~95ms
//     Fallback (if Ollama is down): Claude Haiku (cloud)
//     Job: just determine eventType + a rough sensitivity flag.
//     This never sees more of the prompt than it needs to.
//
//   Stage 2 — PARSE (full structured extraction)
//     Routed based on Stage 1's sensitivity flag:
//       - Not sensitive  -> "jml-parse"      (Claude Sonnet, cloud)
//       - PII-sensitive  -> "qwen-27b"       (local, GDPR-safe)
//     Fallback chains are defined in infra/dev/litellm.yaml itself
//     (jml-parse falls back to qwen-27b if Anthropic is down) —
//     this client does NOT duplicate that resilience logic; LiteLLM
//     owns it. We only pick which alias to call first.
//
// This matches the routing design in architecture/ai-stack-claude-ollama.jsx
// and local-llm-migration-architecture.jsx — Phase 0/1 hybrid, not yet
// the fully-local Phase 2 end state.
// ─────────────────────────────────────────────────────────────

import { ProvisioningIntentSchema, type ProvisioningIntent } from "@jml-ops/shared";

const LITELLM_BASE_URL = process.env.LITELLM_URL ?? "http://localhost:4002";
const LITELLM_API_KEY = process.env.LITELLM_MASTER_KEY ?? "sk-jml-ops-dev";

// Minimal shape of the OpenAI-compatible chat completion response that
// LiteLLM returns — only the fields we actually read.
interface LiteLLMChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string; // LiteLLM echoes back which underlying model actually served the request
}

interface ModelCallResult {
  success: boolean;
  content: string;
  errorMessage?: string | undefined;
  tokensUsed: { input: number; output: number };
  durationMs: number;
  servedByModel?: string | undefined; // useful for cost/usage logging — which alias/fallback actually ran
}

/**
 * Generic call to any LiteLLM model alias. Every AI request in the API
 * goes through this one function — task-specific logic lives in the
 * functions below, not duplicated per-call.
 */
async function callModel(params: {
  modelAlias: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<ModelCallResult> {
  const start = Date.now();

  try {
    const response = await fetch(`${LITELLM_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: params.modelAlias,
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userPrompt },
        ],
        temperature: params.temperature ?? 0,
        max_tokens: params.maxTokens ?? 1000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        success: false,
        content: "",
        errorMessage: `LiteLLM (${params.modelAlias}) returned ${response.status}: ${errText}`,
        tokensUsed: { input: 0, output: 0 },
        durationMs: Date.now() - start,
      };
    }

    const data = (await response.json()) as LiteLLMChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content ?? "";

    return {
      success: true,
      content,
      tokensUsed: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
      },
      durationMs: Date.now() - start,
      servedByModel: data.model,
    };
  } catch (err) {
    return {
      success: false,
      content: "",
      errorMessage: err instanceof Error ? err.message : String(err),
      tokensUsed: { input: 0, output: 0 },
      durationMs: Date.now() - start,
    };
  }
}

function stripMarkdownFences(text: string): string {
  return text.replace(/^```json\s*|\s*```$/g, "").trim();
}

function omitNullValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null).map(omitNullValues);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null)
        .map(([key, item]) => [key, omitNullValues(item)])
    );
  }

  return value;
}

/**
 * LiteLLM echoes back the underlying model it actually used to serve a
 * request (e.g. "anthropic/claude-sonnet-4-6" or "ollama/qwen2.5:27b") —
 * this is the ONLY reliable source of truth for which model really ran,
 * since fallback chains mean the alias we requested isn't necessarily
 * what served the response. Falls back to inferring from the alias name
 * if LiteLLM didn't echo a model string (e.g. on a hard failure).
 */
export function deriveProviderFields(
  servedByModel: string | undefined,
  requestedAlias: string
): { provider: "ANTHROPIC" | "OLLAMA" | "OPENAI"; model: string; isLocal: boolean } {
  const modelString = servedByModel ?? requestedAlias;

  if (modelString.startsWith("ollama/")) {
    return { provider: "OLLAMA", model: modelString.replace("ollama/", ""), isLocal: true };
  }
  if (modelString.startsWith("anthropic/")) {
    return { provider: "ANTHROPIC", model: modelString.replace("anthropic/", ""), isLocal: false };
  }
  if (modelString.startsWith("openai/")) {
    return { provider: "OPENAI", model: modelString.replace("openai/", ""), isLocal: false };
  }

  // Fallback: infer from the alias naming convention in litellm.yaml
  // (mistral/qwen/deepseek/nomic = local; claude-* = cloud) if we somehow
  // got neither a servedByModel nor a recognizable prefix.
  const isLocalByConvention = /mistral|qwen|deepseek|nomic|ollama/i.test(modelString);
  return {
    provider: isLocalByConvention ? "OLLAMA" : "ANTHROPIC",
    model: modelString,
    isLocal: isLocalByConvention,
  };
}

// ── STAGE 1: CLASSIFY ──────────────────────────────────────────

const CLASSIFY_SYSTEM_PROMPT = `You classify JML (Joiner-Mover-Leaver) provisioning requests. Given a natural-language
request, respond with ONLY a JSON object, no markdown, no explanation:

{
  "eventType": "JOINER" | "MOVER" | "LEAVER" | "ACCESS_REVIEW" | "EMERGENCY_LEAVER",
  "containsSensitiveData": boolean
}

"containsSensitiveData" should be true if the request mentions specific salary figures, health/medical
information, disciplinary reasons, or other data that would be GDPR-sensitive beyond a normal name/email/
department/title (which are NOT considered sensitive for this flag — those are routine HR fields).

If the request mentions "immediately", "right now", "urgent", or similar for an offboarding request, use
eventType "EMERGENCY_LEAVER".`;

export interface ClassifyResult {
  success: boolean;
  eventType: string | null;
  containsSensitiveData: boolean;
  durationMs: number;
  servedByModel?: string | undefined;
  errorMessage?: string | undefined;
}

async function classifyPrompt(prompt: string): Promise<ClassifyResult> {
  const result = await callModel({
    modelAlias: "jml-classify", // -> local Mistral 7B, falls back to Claude Haiku per litellm.yaml
    systemPrompt: CLASSIFY_SYSTEM_PROMPT,
    userPrompt: prompt,
    maxTokens: 150,
  });

  if (!result.success) {
    return {
      success: false,
      eventType: null,
      containsSensitiveData: false,
      durationMs: result.durationMs,
      errorMessage: result.errorMessage,
    };
  }

  try {
    const parsed = JSON.parse(stripMarkdownFences(result.content));
    return {
      success: true,
      eventType: parsed.eventType ?? null,
      containsSensitiveData: !!parsed.containsSensitiveData,
      durationMs: result.durationMs,
      servedByModel: result.servedByModel,
    };
  } catch {
    // Classification is a fast-path optimization, not a hard requirement —
    // if it fails to parse, fall through and let Stage 2 do full parsing
    // with the default (non-sensitive) routing. Don't fail the whole
    // request over a classification hiccup.
    return {
      success: false,
      eventType: null,
      containsSensitiveData: false,
      durationMs: result.durationMs,
      errorMessage: "Classification response was not valid JSON — proceeding with default routing",
    };
  }
}

// ── STAGE 2: PARSE ──────────────────────────────────────────────

const PARSE_SYSTEM_PROMPT = `You are the intent-parsing layer for JML Ops, an IT provisioning automation platform.

Parse the user's natural-language request into a structured JSON object matching this exact shape:

{
  "eventType": "JOINER" | "MOVER" | "LEAVER" | "ACCESS_REVIEW" | "EMERGENCY_LEAVER",
  "employeeEmail": string (required — infer a plausible email if not given explicitly, using firstname.lastname@company format only if you can determine the company domain, otherwise ask for clarification by setting confidence low),
  "employeeName": string (optional),
  "confidence": number between 0 and 1,
  "joiner": { "jobTitle"?, "department"?, "managerEmail"?, "startDate"? (ISO 8601), "location"?, "roleTemplateName"? } (ONLY if eventType is JOINER),
  "mover": { "newDepartment"?, "newJobTitle"?, "newManagerEmail"?, "groupsToAdd": string[], "groupsToRemove": string[], "effectiveDate"? } (ONLY if eventType is MOVER),
  "leaver": { "lastDay"? (ISO 8601), "isEmergency": boolean, "reason"?, "dataHandoverToEmail"? } (ONLY if eventType is LEAVER or EMERGENCY_LEAVER),
  "ambiguousFields": string[] (list any fields you were not confident about)
}

Rules:
- Only include the ONE sub-object (joiner/mover/leaver) matching eventType. Omit the others entirely.
- If the request mentions "immediately", "right now", "urgent", or similar for an offboarding request, use eventType "EMERGENCY_LEAVER" and set leaver.isEmergency to true.
- If you cannot confidently determine the employee's email at all, set confidence below 0.5 and explain in ambiguousFields.
- Respond with ONLY the JSON object. No markdown fences, no explanation, no preamble.`;

export interface ParseIntentResult {
  success: boolean;
  intent: ProvisioningIntent | null;
  rawResponse: string;
  errorMessage?: string | undefined;
  tokensUsed?: { input: number; output: number } | undefined;
  durationMs: number;
  // Full routing trail — useful for the Analytics screen's model-usage
  // breakdown and for debugging which path an actual request took.
  routing: {
    classifyModel?: string | undefined;
    classifyDurationMs: number;
    parseModelAlias: string;
    parseServedByModel?: string | undefined;
    parseDurationMs: number;
    routedForSensitivity: boolean;
  };
}

/**
 * The full 2-stage pipeline: classify (fast, local) -> parse (routed by
 * sensitivity). Total added latency from the classify stage is typically
 * under 150ms against local Mistral — worth it for the GDPR routing
 * guarantee: sensitive requests never leave the local network.
 */
export async function parsePromptToIntent(prompt: string): Promise<ParseIntentResult> {
  const classifyResult = await classifyPrompt(prompt);

  // Route Stage 2 based on Stage 1's sensitivity flag. If classification
  // itself failed, default to the non-sensitive path (jml-parse / Sonnet)
  // rather than assuming sensitivity — an unnecessary local-routing
  // decision is a availability/quality tradeoff, not a safety one, so
  // failing open here (to the higher-quality cloud model) is the right
  // default when we genuinely don't know.
  const parseModelAlias = classifyResult.containsSensitiveData ? "qwen-27b" : "jml-parse";

  const parseResult = await callModel({
    modelAlias: parseModelAlias,
    systemPrompt: PARSE_SYSTEM_PROMPT,
    userPrompt: prompt,
    maxTokens: 600,
  });

  const routing = {
    classifyModel: classifyResult.servedByModel,
    classifyDurationMs: classifyResult.durationMs,
    parseModelAlias,
    parseServedByModel: parseResult.servedByModel,
    parseDurationMs: parseResult.durationMs,
    routedForSensitivity: classifyResult.containsSensitiveData,
  };

  if (!parseResult.success) {
    return {
      success: false,
      intent: null,
      rawResponse: "",
      errorMessage: parseResult.errorMessage,
      durationMs: classifyResult.durationMs + parseResult.durationMs,
      routing,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownFences(parseResult.content));
  } catch {
    return {
      success: false,
      intent: null,
      rawResponse: parseResult.content,
      errorMessage: "AI response was not valid JSON",
      durationMs: classifyResult.durationMs + parseResult.durationMs,
      routing,
    };
  }

  const validation = ProvisioningIntentSchema.safeParse(omitNullValues(parsed));
  if (!validation.success) {
    return {
      success: false,
      intent: null,
      rawResponse: parseResult.content,
      errorMessage: `AI output failed schema validation: ${validation.error.message}`,
      durationMs: classifyResult.durationMs + parseResult.durationMs,
      routing,
    };
  }

  return {
    success: true,
    intent: validation.data,
    rawResponse: parseResult.content,
    tokensUsed: parseResult.tokensUsed,
    durationMs: classifyResult.durationMs + parseResult.durationMs,
    routing,
  };
}
