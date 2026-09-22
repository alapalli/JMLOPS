"use client";

// ─────────────────────────────────────────────────────────────
// Change Requests Screen — the lightweight approval queue.
//
// Every authenticated user can submit a request and see their own
// history. ADMIN users additionally see every pending request
// company-wide, with approve/reject actions. This is deliberately
// NOT durable multi-step workflow orchestration (Temporal) — that
// remains a separate, larger, explicitly-deferred roadmap item.
// This is a real, working gate in front of the existing job
// pipeline, nothing more.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { api, type ChangeRequestRow, type CurrentUser } from "../../lib/api-client";
import { AppShell, T, Badge } from "../../components/AppShell";

export default function RequestsPage() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [requests, setRequests] = useState<ChangeRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);

  useEffect(() => {
    api.getCurrentUser().then(setCurrentUser).catch(console.error);
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      setRequests(await api.listChangeRequests());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (prompt.trim().length < 3) return;
    setSubmitting(true);
    try {
      await api.submitChangeRequest(prompt.trim(), reason.trim() || undefined);
      setPrompt("");
      setReason("");
      await refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(id: string) {
    setActioningId(id);
    try {
      await api.approveChangeRequest(id);
      await refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setActioningId(null);
    }
  }

  async function handleReject(id: string) {
    const note = window.prompt("Reason for rejecting (optional):") ?? undefined;
    setActioningId(id);
    try {
      await api.rejectChangeRequest(id, note);
      await refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setActioningId(null);
    }
  }

  const isAdmin = currentUser?.role === "ADMIN";
  const pending = requests.filter((r) => r.status === "PENDING");

  return (
    <AppShell title="Change Requests" sub={isAdmin ? "Submit requests, and review pending approvals" : "Submit a request and track its status"}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.lo, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
              Submit a change request
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the change — e.g. 'Add jane.doe@company.com to the Finance-Readonly group'"
              rows={3}
              style={{
                width: "100%", background: T.raise, border: `1px solid ${T.line2}`, borderRadius: 7,
                padding: "10px 12px", color: T.hi, fontSize: 12.5, outline: "none", resize: "vertical", boxSizing: "border-box", marginBottom: 8,
              }}
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional) — helps the approver decide faster"
              style={{
                width: "100%", background: T.raise, border: `1px solid ${T.line2}`, borderRadius: 7,
                padding: "9px 12px", color: T.hi, fontSize: 12, outline: "none", boxSizing: "border-box", marginBottom: 10,
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={submitting || prompt.trim().length < 3}
              style={{
                background: T.info, color: "#fff", border: "none", borderRadius: 6,
                padding: "9px 18px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                opacity: submitting || prompt.trim().length < 3 ? 0.5 : 1,
              }}
            >
              {submitting ? "Submitting..." : "Submit for approval"}
            </button>
          </div>

          {isAdmin && pending.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.warn, marginBottom: 12 }}>
                Pending your approval ({pending.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {pending.map((r) => (
                  <div key={r.id} style={{ background: T.card, border: `1px solid ${T.warn}40`, borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: 12, color: T.hi, marginBottom: 6 }}>{r.prompt}</div>
                    {r.reason && <div style={{ fontSize: 11, color: T.lo, marginBottom: 8, fontStyle: "italic" }}>&ldquo;{r.reason}&rdquo;</div>}
                    <div style={{ fontSize: 10, color: T.lo, marginBottom: 10 }}>
                      Requested by {r.requestedBy.name} \u00b7 {new Date(r.createdAt).toLocaleString()}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => handleApprove(r.id)}
                        disabled={actioningId === r.id}
                        style={{ background: T.success, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", opacity: actioningId === r.id ? 0.5 : 1 }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(r.id)}
                        disabled={actioningId === r.id}
                        style={{ background: "transparent", color: T.danger, border: `1px solid ${T.danger}60`, borderRadius: 6, padding: "6px 14px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", opacity: actioningId === r.id ? 0.5 : 1 }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.hi, marginBottom: 12 }}>
            {isAdmin ? "All requests" : "Your requests"}
          </div>
          {loading && <div style={{ color: T.mid, fontSize: 13 }}>Loading...</div>}
          {!loading && requests.length === 0 && (
            <div style={{ color: T.lo, fontSize: 13, textAlign: "center", padding: 40 }}>No requests yet.</div>
          )}
          {!loading && requests.length > 0 && (
            <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.line}`, overflow: "hidden" }}>
              {requests.map((r, i) => (
                <div key={r.id} style={{ padding: "12px 14px", borderBottom: i < requests.length - 1 ? `1px solid ${T.line}` : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                    <div style={{ fontSize: 11.5, color: T.hi, maxWidth: "75%" }}>{r.prompt}</div>
                    <Badge label={r.status} color={statusColor(r.status)} />
                  </div>
                  <div style={{ fontSize: 10, color: T.lo }}>
                    {isAdmin && `${r.requestedBy.name} \u00b7 `}
                    {new Date(r.createdAt).toLocaleDateString()}
                    {r.reviewedBy && ` \u00b7 reviewed by ${r.reviewedBy.name}`}
                  </div>
                  {r.reviewNote && <div style={{ fontSize: 10, color: T.danger, marginTop: 4, fontStyle: "italic" }}>&ldquo;{r.reviewNote}&rdquo;</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function statusColor(status: string): string {
  if (status === "APPROVED") return T.success;
  if (status === "REJECTED") return T.danger;
  return T.warn;
}
