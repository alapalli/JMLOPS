"use client";

// ─────────────────────────────────────────────────────────────
// Self-Service Portal — for actual employees, not IT staff.
// Deliberately simpler than /requests (the IT-staff Change
// Requests screen): no approval queue shown here, since an
// employee never approves requests, only submits and tracks
// their own. The request TYPE is chosen from a fixed list and
// the identity is always the requester themselves, server-
// enforced — there's no free-text "who" field, by design.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { api, type SelfServiceRequestRow } from "../../lib/api-client";
import { AppShell, T, Badge } from "../../components/AppShell";

const REQUEST_TYPES = [
  { value: "MOVER_REQUEST", label: "Request a team/role change", icon: "\ud83d\udfe1", placeholder: "e.g. moving to the Security team as of next month" },
  { value: "ACCESS_REQUEST", label: "Request access to something", icon: "\ud83d\udd11", placeholder: "e.g. access to the Finance-Readonly reporting dashboard" },
  { value: "LEAVER_REQUEST", label: "Report my last day / resignation", icon: "\ud83d\udd34", placeholder: "e.g. my last day will be March 15th" },
] as const;

export default function SelfServicePage() {
  const [requests, setRequests] = useState<SelfServiceRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestType, setRequestType] = useState<string>("ACCESS_REQUEST");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      setRequests(await api.listSelfServiceRequests());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (details.trim().length < 3) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await api.submitSelfServiceRequest(requestType, details.trim());
      setDetails("");
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong submitting your request.");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedType = REQUEST_TYPES.find((t) => t.value === requestType) ?? REQUEST_TYPES[0];

  return (
    <AppShell title="My Requests" sub="Raise a request about your own access, role, or status">
      <div style={{ maxWidth: 640 }}>
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 18, boxShadow: T.shadow, marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.lo, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 }}>
            What do you need?
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {REQUEST_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setRequestType(t.value)}
                style={{
                  background: requestType === t.value ? T.claude + "14" : T.raise,
                  border: `1px solid ${requestType === t.value ? T.claude : T.line2}`,
                  color: requestType === t.value ? T.claude : T.mid,
                  borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={selectedType.placeholder}
            rows={3}
            style={{
              width: "100%", background: T.raise, border: `1px solid ${T.line2}`, borderRadius: 6,
              padding: "10px 12px", color: T.hi, fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", marginBottom: 10,
            }}
          />

          {errorMessage && (
            <div style={{ background: T.dangerBg, border: `1px solid ${T.danger}40`, borderRadius: 6, padding: "10px 12px", fontSize: 12, color: T.danger, marginBottom: 10 }}>
              {errorMessage}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || details.trim().length < 3}
            style={{
              background: T.claude, color: "#fff", border: "none", borderRadius: 6,
              padding: "10px 20px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              opacity: submitting || details.trim().length < 3 ? 0.5 : 1,
            }}
          >
            {submitting ? "Submitting..." : "Submit request"}
          </button>
          <span style={{ fontSize: 10.5, color: T.lo, marginLeft: 12 }}>
            This goes to your IT admin for approval before anything changes.
          </span>
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: T.hi, marginBottom: 12 }}>Your request history</div>
        {loading && <div style={{ color: T.mid, fontSize: 13 }}>Loading...</div>}
        {!loading && requests.length === 0 && (
          <div style={{ color: T.lo, fontSize: 13, textAlign: "center", padding: 30 }}>
            You haven&apos;t submitted any requests yet.
          </div>
        )}
        {!loading && requests.length > 0 && (
          <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.line}`, overflow: "hidden", boxShadow: T.shadow }}>
            {requests.map((r, i) => (
              <div key={r.id} style={{ padding: "12px 16px", borderBottom: i < requests.length - 1 ? `1px solid ${T.line}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <div style={{ fontSize: 12, color: T.hi, maxWidth: "75%" }}>{r.prompt}</div>
                  <Badge label={r.status} color={statusColor(r.status)} />
                </div>
                <div style={{ fontSize: 10.5, color: T.lo }}>{new Date(r.createdAt).toLocaleDateString()}</div>
                {r.reviewNote && (
                  <div style={{ fontSize: 10.5, color: T.danger, marginTop: 4, fontStyle: "italic" }}>&ldquo;{r.reviewNote}&rdquo;</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function statusColor(status: string): string {
  if (status === "APPROVED") return T.success;
  if (status === "REJECTED") return T.danger;
  return T.warn;
}
