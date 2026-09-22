"use client";

// ─────────────────────────────────────────────────────────────
// Mover Screen — real job history (unchanged) PLUS a new
// drag-and-drop panel with two zones: apps to ADD and apps to
// REMOVE, reflecting the real shape of a role change. Visual/demo
// interaction only — see AppTiles.tsx header for scope.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { api, type JobSummary, type JobDetail } from "../../lib/api-client";
import { AppShell, T, Badge, StatusDot } from "../../components/AppShell";
import { AppCatalog, AppDropZone, type AppAssignment } from "../../components/AppTiles";

export default function MoverPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<JobDetail | null>(null);
  const [toAdd, setToAdd] = useState<AppAssignment[]>([]);
  const [toRemove, setToRemove] = useState<AppAssignment[]>([]);

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
      const movers = all.filter((j) => j.eventType === "MOVER");
      setJobs(movers);
      const first = movers[0];
      if (first && !selectedId) setSelectedId(first.id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell title="Mover" sub="Role transfers & team changes">
      {/* ── New: drag-and-drop add/remove access planning (visual/demo interaction) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        <AppCatalog configuredTypes={[]} />
        <AppDropZone
          title="Access to add"
          color={T.success}
          assigned={toAdd}
          onDrop={(app) => {
            setToAdd((prev) => [...prev, app]);
            setToRemove((prev) => prev.filter((a) => a.type !== app.type));
          }}
          onRemove={(type) => setToAdd((prev) => prev.filter((a) => a.type !== type))}
          emptyMessage="Drag apps here to add for the new role"
        />
        <AppDropZone
          title="Access to remove"
          color={T.danger}
          assigned={toRemove}
          onDrop={(app) => {
            setToRemove((prev) => [...prev, app]);
            setToAdd((prev) => prev.filter((a) => a.type !== app.type));
          }}
          onRemove={(type) => setToRemove((prev) => prev.filter((a) => a.type !== type))}
          emptyMessage="Drag apps here to remove from the old role"
        />
      </div>

      {loading && <div style={{ color: T.mid, fontSize: 13 }}>Loading...</div>}

      {!loading && jobs.length === 0 && (
        <EmptyState message="No mover requests yet — submit one from the Prompt Console." />
      )}

      {!loading && jobs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {jobs.map((job) => (
              <button
                key={job.id}
                onClick={() => setSelectedId(job.id)}
                style={{
                  textAlign: "left", background: T.card,
                  border: `1px solid ${selectedId === job.id ? T.info : T.line}`,
                  borderRadius: 10, padding: "14px 18px", cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ maxWidth: "70%" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.hi, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {job.prompt ?? "(no prompt text)"}
                    </div>
                    <div style={{ fontSize: 10, color: T.lo, fontFamily: "monospace" }}>
                      {new Date(job.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Badge label={job.status} color={statusColor(job.status)} />
                </div>
              </button>
            ))}
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.hi, marginBottom: 12 }}>
              {selectedDetail ? "Access Changes" : "Select a job"}
            </div>
            {selectedDetail && (
              <>
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

                <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.info}30`, padding: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.info, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>
                    Original Prompt
                  </div>
                  <div style={{ fontSize: 11, color: T.mid, fontFamily: "monospace", lineHeight: 1.7, fontStyle: "italic" }}>
                    {selectedDetail.prompt ?? "(no prompt recorded)"}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                    <Tag label={`${selectedDetail.completedSteps}/${selectedDetail.totalSteps} steps`} color={T.info} />
                    {selectedDetail.parsedIntent && (
                      <Tag label={`${Math.round(selectedDetail.parsedIntent.confidence * 100)}% confidence`} color={T.local} />
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
