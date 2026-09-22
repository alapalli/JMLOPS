"use client";

// ─────────────────────────────────────────────────────────────
// Employees Screen — real directory, built on the new
// /api/employees routes. Clicking an employee opens the detail
// block requested: manager, start date, end date, job role,
// location, plus their real provisioning job history.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { api, type EmployeeSummary, type EmployeeDetail } from "../../lib/api-client";
import { AppShell, T, Badge } from "../../components/AppShell";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    api
      .listEmployees()
      .then(setEmployees)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    api
      .getEmployee(selectedId)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const filtered = employees.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.name.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      (e.jobTitle ?? "").toLowerCase().includes(q) ||
      (e.department ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <AppShell title="Employees" sub={`${employees.length} people`}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20 }}>
        <div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, role, department..."
            style={{
              width: "100%", background: T.card, border: `1px solid ${T.line2}`, borderRadius: 8,
              padding: "10px 14px", color: T.hi, fontSize: 13, outline: "none", boxSizing: "border-box",
              marginBottom: 14,
            }}
          />

          {loading && <div style={{ color: T.mid, fontSize: 13 }}>Loading...</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ color: T.lo, fontSize: 13, textAlign: "center", padding: 40 }}>
              No employees match &ldquo;{search}&rdquo;.
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.line}`, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Name</th>
                    <th style={th}>Role</th>
                    <th style={th}>Department</th>
                    <th style={th}>Manager</th>
                    <th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => setSelectedId(e.id)}
                      style={{
                        cursor: "pointer",
                        background: selectedId === e.id ? T.raise : "transparent",
                      }}
                    >
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: T.hi }}>{e.name}</div>
                        <div style={{ fontSize: 10, color: T.lo }}>{e.email}</div>
                      </td>
                      <td style={{ ...td, color: T.mid }}>{e.jobTitle ?? "—"}</td>
                      <td style={{ ...td, color: T.mid }}>{e.department ?? "—"}</td>
                      <td style={{ ...td, color: T.lo, fontSize: 11 }}>{e.manager?.name ?? "—"}</td>
                      <td style={td}>
                        <Badge label={e.isActive ? "Active" : "Left"} color={e.isActive ? T.success : T.lo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.hi, marginBottom: 12 }}>
            {detail ? "Employee Details" : "Select an employee"}
          </div>

          {detailLoading && <div style={{ color: T.mid, fontSize: 13 }}>Loading...</div>}

          {detail && !detailLoading && (
            <>
              {/* ── The requested detail block: manager, start/end date, role, location ── */}
              <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.line}`, padding: 18, marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.hi, marginBottom: 2 }}>{detail.name}</div>
                <div style={{ fontSize: 11, color: T.lo, marginBottom: 16 }}>{detail.email}</div>

                <DetailRow label="Job Role" value={detail.jobTitle ?? "—"} />
                <DetailRow label="Department" value={detail.department ?? "—"} />
                <DetailRow label="Location" value={detail.location ?? "—"} />
                <DetailRow label="Manager" value={detail.manager?.name ?? "—"} />
                <DetailRow label="Start Date" value={formatDate(detail.startDate)} />
                <DetailRow label="End Date" value={detail.endDate ? formatDate(detail.endDate) : "—"} />
                <DetailRow
                  label="Status"
                  value={<Badge label={detail.isActive ? "Active" : "Left company"} color={detail.isActive ? T.success : T.lo} />}
                  isNode
                />

                {detail.reports.length > 0 && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.line}` }}>
                    <div style={{ fontSize: 10, color: T.lo, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                      Direct reports ({detail.reports.length})
                    </div>
                    {detail.reports.map((r) => (
                      <div key={r.id} style={{ fontSize: 12, color: T.mid, marginBottom: 4 }}>
                        {r.name} <span style={{ color: T.lo, fontSize: 10 }}>· {r.jobTitle ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: T.lo, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                Job History
              </div>
              <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.line}`, overflow: "hidden" }}>
                {detail.jobHistory.length === 0 && (
                  <div style={{ padding: 16, fontSize: 12, color: T.lo }}>No provisioning jobs recorded.</div>
                )}
                {detail.jobHistory.map((job, i) => (
                  <div
                    key={job.id}
                    style={{
                      padding: "10px 14px",
                      borderBottom: i < detail.jobHistory.length - 1 ? `1px solid ${T.line}` : "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <Badge label={job.eventType} color={eventColor(job.eventType)} />
                      <span style={{ fontSize: 10, color: T.lo }}>{formatDate(job.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: T.mid }}>{job.prompt ?? "—"}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function DetailRow({ label, value, isNode = false }: { label: string; value: string | React.ReactNode; isNode?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${T.line}` }}>
      <span style={{ fontSize: 11, color: T.lo }}>{label}</span>
      {isNode ? value : <span style={{ fontSize: 12, color: T.hi, fontWeight: 500 }}>{value as string}</span>}
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function eventColor(eventType: string): string {
  if (eventType === "JOINER") return T.success;
  if (eventType === "MOVER") return T.info;
  if (eventType === "LEAVER" || eventType === "EMERGENCY_LEAVER") return T.danger;
  return T.local;
}

const th: React.CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 9, fontWeight: 700, color: T.lo, textTransform: "uppercase", letterSpacing: 1, borderBottom: `1px solid ${T.line}` };
const td: React.CSSProperties = { padding: "9px 12px", fontSize: 12, borderBottom: `1px solid ${T.line}` };
