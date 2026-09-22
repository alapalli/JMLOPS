// ─────────────────────────────────────────────────────────────
// @jml-ops/web — API Client
//
// Auth: the session lives in an httpOnly cookie set by the API on
// successful SSO login (see apps/api/src/auth.ts). This client never
// touches the token directly — the browser sends the cookie
// automatically on every request as long as `credentials: "include"`
// is set, and the API validates it server-side. No localStorage,
// no manual token handling.
// ─────────────────────────────────────────────────────────────

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include", // send the jml_session cookie
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (response.status === 401) {
    // Session expired or missing — send the user to log in again.
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Not authenticated");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return response.json();
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  companyId: string;
}

export interface EmployeeManagerRef {
  id: string;
  name: string;
  email?: string | undefined;
}

export interface EmployeeSummary {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  manager: EmployeeManagerRef | null;
}

export interface EmployeeJobHistoryRow {
  id: string;
  eventType: string;
  status: string;
  prompt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface EmployeeDetail extends EmployeeSummary {
  reports: { id: string; name: string; jobTitle: string | null }[];
  jobHistory: EmployeeJobHistoryRow[];
}

export interface ChangeRequestUserRef {
  id: string;
  name: string;
  email?: string;
}

export interface ChangeRequestRow {
  id: string;
  prompt: string;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedBy: ChangeRequestUserRef;
  reviewedBy: ChangeRequestUserRef | null;
  reviewNote: string | null;
  resultingJobId: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface AssetEmployeeRef {
  id: string;
  name: string;
  email: string;
}

export interface AssetRow {
  id: string;
  type: "LAPTOP" | "PHONE" | "BADGE" | "MONITOR" | "OTHER";
  label: string;
  serialNumber: string | null;
  status: "ASSIGNED" | "RETURNED" | "LOST";
  assignedAt: string;
  returnedAt: string | null;
  notes: string | null;
  employee: AssetEmployeeRef | null;
}

export interface SelfServiceRequestRow {
  id: string;
  prompt: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface ParsedIntent {
  eventType: string;
  employeeEmail: string;
  employeeName?: string;
  confidence: number;
  ambiguousFields: string[];
  [key: string]: unknown;
}

export interface SubmitPromptResponse {
  jobId: string;
  status: string;
  parsedIntent: ParsedIntent | null;
  error?: string;
}

export interface JobStep {
  id: string;
  connectorType: string;
  action: string;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
}

export interface JobDetail {
  id: string;
  eventType: string;
  status: string;
  prompt: string | null;
  parsedIntent: ParsedIntent | null;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  steps: JobStep[];
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface JobSummary {
  id: string;
  eventType: string;
  status: string;
  prompt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AuditRow {
  id: string;
  eventType: string;
  actorEmail: string | null;
  employeeEmail: string | null;
  jobId: string | null;
  connectorType: string | null;
  action: string;
  createdAt: string;
  verified: boolean | null;
}

export interface ConnectorStatus {
  id: string;
  type: string;
  name: string;
  status: string;
  isEnabled: boolean;
  lastSyncAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  errorCount: number;
}

export interface AnalyticsModelUsage {
  model: string;
  calls: number;
  costUsd: number;
  isLocal: boolean;
}

export interface AnalyticsTaskUsage {
  task: string;
  calls: number;
  avgDurationMs: number;
  costUsd: number;
  model: string;
  isLocal: boolean;
}

export interface AnalyticsSummary {
  periodDays: number;
  totalCalls: number;
  cloudCallCount: number;
  localCallCount: number;
  totalCostUsd: number;
  avgDurationMs: number;
  byModel: AnalyticsModelUsage[];
  byTask: AnalyticsTaskUsage[];
}

export const api = {
  getCurrentUser: () => apiFetch<CurrentUser>("/auth/me"),

  logout: () => apiFetch<{ success: boolean }>("/auth/logout", { method: "POST" }),

  submitPrompt: (prompt: string) =>
    apiFetch<SubmitPromptResponse>("/api/jml/submit", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  getJob: (jobId: string) => apiFetch<JobDetail>(`/api/jml/jobs/${jobId}`),

  listJobs: () => apiFetch<JobSummary[]>("/api/jml/jobs"),

  getAuditLog: (params?: { eventType?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.eventType) qs.set("eventType", params.eventType);
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return apiFetch<AuditRow[]>(`/api/audit${query ? `?${query}` : ""}`);
  },

  listConnectors: () => apiFetch<ConnectorStatus[]>("/api/connectors"),

  testConnector: (id: string) =>
    apiFetch<{ success: boolean; errorMessage?: string }>(`/api/connectors/${id}/test`, {
      method: "POST",
    }),

  getAnalyticsSummary: () => apiFetch<AnalyticsSummary>("/api/analytics/summary"),

  listChangeRequests: () => apiFetch<ChangeRequestRow[]>("/api/requests"),
  submitChangeRequest: (prompt: string, reason?: string) =>
    apiFetch<{ id: string; status: string }>("/api/requests", {
      method: "POST",
      body: JSON.stringify({ prompt, reason }),
    }),
  approveChangeRequest: (id: string) =>
    apiFetch<{ id: string; status: string; resultingJobId: string }>(`/api/requests/${id}/approve`, { method: "POST" }),
  rejectChangeRequest: (id: string, note?: string) =>
    apiFetch<{ id: string; status: string }>(`/api/requests/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  listAssets: () => apiFetch<AssetRow[]>("/api/assets"),
  listEmployeeAssets: (employeeId: string) => apiFetch<AssetRow[]>(`/api/assets/employee/${employeeId}`),

  listEmployees: () => apiFetch<EmployeeSummary[]>("/api/employees"),
  getEmployee: (id: string) => apiFetch<EmployeeDetail>(`/api/employees/${id}`),
  assignAsset: (data: { employeeId?: string | undefined; type: string; label: string; serialNumber?: string | undefined; notes?: string | undefined }) =>
    apiFetch<{ id: string; status: string }>("/api/assets", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  returnAsset: (id: string) =>
    apiFetch<{ id: string; status: string }>(`/api/assets/${id}/return`, { method: "POST" }),

  submitSelfServiceRequest: (requestType: string, details: string) =>
    apiFetch<{ id: string; status: string }>("/api/self-service/request", {
      method: "POST",
      body: JSON.stringify({ requestType, details }),
    }),
  listSelfServiceRequests: () => apiFetch<SelfServiceRequestRow[]>("/api/self-service/requests"),
};

export function getWebSocketUrl(): string {
  // The jml_session cookie is sent automatically by the browser on the
  // WebSocket handshake request (same mechanism as any other same-site
  // request) — no token needs to be passed in the URL. The API reads
  // the cookie server-side; see apps/api/src/index.ts's /ws route.
  const wsBase = API_BASE_URL.replace(/^http/, "ws");
  return `${wsBase}/ws`;
}

export function getLoginUrl(provider: "google" | "microsoft"): string {
  return `${API_BASE_URL}/auth/${provider}/login`;
}
