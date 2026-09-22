"use client";

// ─────────────────────────────────────────────────────────────
// Leaver Screen — real job history (unchanged) PLUS a new
// drag-and-drop revocation panel. Unlike Joiner/Mover, this
// starts pre-populated with a representative set of "current
// access" (since the point of offboarding is what's being taken
// away, not added) — removing a tile represents revocation.
// Visual/demo interaction only — see AppTiles.tsx header.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { api, type JobSummary, type JobDetail } from "../../lib/api-client";
import { AppShell, T, Badge, StatusDot } from "../../components/AppShell";
import { AppDropZone, type AppAssignment } from "../../components/AppTiles";

// A representative starting set of "current access" for the revocation
// panel — since this is a visual/demo interaction (not reading a real
// employee's live entitlements from Entra), this is deliberately generic
// rather than tied to whichever job is selected below.
const REPRESENTATIVE_ACCESS: AppAssignment[] = [
  { type: "ENTRA_ID", label: "Entra ID", icon: "\ud83d\udd10" },
  { type: "GOOGLE_WORKSPACE", label: "Google Workspace", icon: "\ud83d\udce7" },
  { type: "SLACK", label: "Slack", icon: "\ud83d\udcac" },
  { type: "GITHUB", label: "GitHub", icon: "\ud83d\udc19" },
];

export default function LeaverPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<JobDetail | null>(null);
  const [currentAccess, setCurrentAccess] = useState<AppAssignment[]>(REPRESENTATIVE_ACCESS);
  const [revoked, setRevoked] = useState<AppAssignment[]>([]);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    api.getJob(selectedId).then(setSelectedDetail).catch(console.error);
  }, [selectedId]);

  async function refresh() {
    setLoading(true);
    try {
      const all = await api.listJobs();
      const leavers = all.filter((j) => j.eventType === "LEAVER" || j.eventType === "EMERGENCY_LEAVER");
      setJobs(leavers);
      const first = leavers[0];
      if (first && !selectedId) setSelectedId(first.id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function revoke(type: string) {
    const app = currentAccess.find((a) => a.type === type);
    if (!app) return;
    setCurrentAccess((prev) => prev.filter((a) => a.type !== type));
    setRevoked((prev) => [...prev, app]);
  }

  function restore(type: string) {
    const app = revoked.find((a) => a.type === type);
    if (!app) return;
    setRevoked((prev) => prev.filter((a) => a.type !== type));
    setCurrentAccess((prev) => [...prev, app]);
  }

  const selectedJob = jobs.find((j) => j.id === selectedId);
  const isEmergency = selectedJob?.eventType === "EMERGENCY_LEAVER";

  return (
    <AppShell title="Leaver" sub="Offboarding & access revocation">
      {/* ── New: drag-to-revoke access panel (visual/demo interaction) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.lo, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Current access — drag out to revoke
          </div>
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16, minHeight: 140 }}>
            {currentAccess.length === 0 && (
              <div style={{ fontSize: 12, color: T.lo, textAlign: "center", padding: "20px 0" }}>
                All access revoked
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {currentAccess.map((app) => (
                <div
                  key={app.type}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/json", JSON.stringify(app));
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, background: T.raise,
                    border: `1px solid ${T.line2}`, borderRadius: 6, padding: "8px 10px", cursor: "grab",
                  }}
                >
                  <span style={{ fontSize: 15 }}>{app.icon}</span>
                  <span style={{ flex: 1, fontSize: 12, color: T.hi, fontWeight: 500 }}>{app.label}</span>
                  <button
                    onClick={() => revoke(app.type)}
                    style={{ background: "transparent", border: "none", color: T.danger, cursor: "pointer", fontSize: 10, fontWeight: 700 }}
                  >
                    REVOKE
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <AppDropZone
          title="Revoked"
          color={T.danger}
          assigned={revoked}
          onDrop={(app) => {
            setRevoked((prev) => [...prev, app]);
            setCurrentAccess((prev) => prev.filter((a) => a.type !== app.type));
          }}
          onRemove={restore}
          emptyMessage="Drag access here, or click REVOKE, to remove it"
        />
      </div>

      {loading && <div style={{ color: T.mid, fontSize: 13 }}>Loading...</div>}

      {!loading && jobs.length === 0 && (
        <EmptyState message="No leaver requests yet — submit one from the Prompt Console." />
      )}

      {!loading && jobs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {jobs.map((job) => {
              const emergency = job.eventType === "EMERGENCY_LEAVER";
              return (
                <button
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  style={{
                    textAlign: "left", background: T.card,
                    border: `1px solid ${selectedId === job.id ? T.danger : T.line}`,
                    borderRadius: 10, padding: "14px 18px", cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ maxWidth: "65%" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.hi, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {job.prompt ?? "(no prompt text)"}
                      </div>
                      <div style={{ fontSize: 10, color: T.lo, fontFamily: "monospace" }}>
                        {new Date(job.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexDirection: "column", alignItems: "flex-end" }}>
                      {emergency && <Badge label="EMERGENCY" color={T.danger} />}
                      <Badge label={job.status} color={statusColor(job.status)} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.hi, marginBottom: 12 }}>
              {selectedDetail ? "Revocation Steps (in order)" : "Select a job"}
            </div>
            {selectedDetail && (
              <>
                {isEmergency && (
                  <div style={{ background: T.dangerBg, border: `1px solid ${T.danger}40`, borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 11, color: T.danger }}>
                    \u26a0 Emergency offboard — processed at highest priority
                  </div>
                )}
                <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.line}`, overflow: "hidden", marginBottom: 16 }}>
                  {selectedDetail.steps.length === 0 && (
                    <div style={{ padding: 16, fontSize: 12, color: T.lo }}>No steps recorded yet.</div>
                  )}
                  {selectedDetail.steps.map((step, i) => (
                    <div
                      key={step.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "11px 16px",
                        borderBottom: i < selectedDetail.steps.length - 1 ? `1px solid ${T.line}` : "none",
                      }}
                    >
                      <div style={{ fontFamily: "monospace", fontSize: 10, color: T.lo, width: 18 }}>{i + 1}</div>
                      <StatusDot status={stepDotStatus(step.status)} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: T.hi }}>{step.action}</div>
                        <div style={{ fontSize: 10, color: T.lo }}>
                          {step.connectorType}
                          {step.durationMs != null && ` \u00b7 ${step.durationMs}ms`}
                          {step.errorMessage && ` \u00b7 ${step.errorMessage}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.danger}30`, padding: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.danger, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>
                    Original Prompt
                  </div>
                  <div style={{ fontSize: 11, color: T.mid, fontFamily: "monospace", lineHeight: 1.7, fontStyle: "italic" }}>
                    {selectedDetail.prompt ?? "(no prompt recorded)"}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                    <Tag label={`${selectedDetail.completedSteps}/${selectedDetail.totalSteps} steps`} color={T.danger} />
                    {selectedDetail.failedSteps > 0 && (
                      <Tag label={`${selectedDetail.failedSteps} failed`} color={T.danger} />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ background: color + "20", color, border: `1px solid ${color}40`, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
      {label}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div style={{ color: T.lo, fontSize: 13, textAlign: "center", padding: 40 }}>{message}</div>;
}

function statusColor(status: string): string {
  if (status === "COMPLETED") return T.success;
  if (status === "FAILED") return T.danger;
  if (status === "PARTIALLY_FAILED") return T.warn;
  return T.lo;
}

function stepDotStatus(status: string): "active" | "pending" | "failed" | "idle" | "running" {
  if (status === "COMPLETED") return "active";
  if (status === "FAILED") return "failed";
  if (status === "IN_PROGRESS" || status === "RUNNING") return "running";
  return "pending";
}
