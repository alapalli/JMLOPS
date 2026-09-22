"use client";

// ─────────────────────────────────────────────────────────────
// Assets Screen — asset tracking tied to onboarding/offboarding.
// Real data from the new /api/assets routes. Assigning an asset
// during onboarding and marking it returned during offboarding
// are both real, first-class actions here — this is the minimal
// version scoped tonight: no procurement/purchasing workflow yet,
// that's a separate, larger, explicitly-deferred scope.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { api, type AssetRow } from "../../lib/api-client";
import { AppShell, T, Badge } from "../../components/AppShell";

const ASSET_TYPES = ["LAPTOP", "PHONE", "BADGE", "MONITOR", "OTHER"] as const;
const TYPE_ICONS: Record<string, string> = {
  LAPTOP: "\ud83d\udcbb",
  PHONE: "\ud83d\udcf1",
  BADGE: "\ud83c\udd94",
  MONITOR: "\ud83d\udda5\ufe0f",
  OTHER: "\ud83d\udce6",
};

export default function AssetsPage() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignType, setAssignType] = useState<string>("LAPTOP");
  const [assignLabel, setAssignLabel] = useState("");
  const [assignSerial, setAssignSerial] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      setAssets(await api.listAssets());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAssign() {
    if (assignLabel.trim().length < 2) return;
    setAssigning(true);
    try {
      await api.assignAsset({
        type: assignType,
        label: assignLabel.trim(),
        serialNumber: assignSerial.trim() || undefined,
      });
      setAssignLabel("");
      setAssignSerial("");
      setShowAssignForm(false);
      await refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setAssigning(false);
    }
  }

  async function handleReturn(id: string) {
    setActioningId(id);
    try {
      await api.returnAsset(id);
      await refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setActioningId(null);
    }
  }

  const filtered = assets.filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      a.label.toLowerCase().includes(q) ||
      (a.serialNumber ?? "").toLowerCase().includes(q) ||
      (a.employee?.name ?? "").toLowerCase().includes(q)
    );
  });

  const assignedCount = assets.filter((a) => a.status === "ASSIGNED").length;

  return (
    <AppShell title="Assets" sub={`${assets.length} tracked \u00b7 ${assignedCount} currently assigned`}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by label, serial number, or employee..."
          style={{
            flex: 1, background: T.card, border: `1px solid ${T.line2}`, borderRadius: 8,
            padding: "10px 14px", color: T.hi, fontSize: 13, outline: "none",
          }}
        />
        <button
          onClick={() => setShowAssignForm((v) => !v)}
          style={{
            background: T.info, color: "#fff", border: "none", borderRadius: 8,
            padding: "10px 20px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
          }}
        >
          {showAssignForm ? "Cancel" : "+ Assign Asset"}
        </button>
      </div>

      {showAssignForm && (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <select
              value={assignType}
              onChange={(e) => setAssignType(e.target.value)}
              style={{ background: T.raise, border: `1px solid ${T.line2}`, borderRadius: 6, padding: "9px 10px", color: T.hi, fontSize: 12.5 }}
            >
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>
              ))}
            </select>
            <input
              value={assignLabel}
              onChange={(e) => setAssignLabel(e.target.value)}
              placeholder="Label — e.g. MacBook Pro 14&quot; 2026"
              style={{ background: T.raise, border: `1px solid ${T.line2}`, borderRadius: 6, padding: "9px 10px", color: T.hi, fontSize: 12.5 }}
            />
            <input
              value={assignSerial}
              onChange={(e) => setAssignSerial(e.target.value)}
              placeholder="Serial number (optional)"
              style={{ background: T.raise, border: `1px solid ${T.line2}`, borderRadius: 6, padding: "9px 10px", color: T.hi, fontSize: 12.5 }}
            />
          </div>
          <button
            onClick={handleAssign}
            disabled={assigning || assignLabel.trim().length < 2}
            style={{
              background: T.success, color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer",
              opacity: assigning || assignLabel.trim().length < 2 ? 0.5 : 1,
            }}
          >
            {assigning ? "Adding..." : "Add to inventory"}
          </button>
          <span style={{ fontSize: 10.5, color: T.lo, marginLeft: 12 }}>
            Not yet linked to a specific employee — link it from an employee&apos;s detail view.
          </span>
        </div>
      )}

      {loading && <div style={{ color: T.mid, fontSize: 13 }}>Loading...</div>}
      {!loading && filtered.length === 0 && (
        <div style={{ color: T.lo, fontSize: 13, textAlign: "center", padding: 40 }}>
          {assets.length === 0 ? "No assets tracked yet." : `No assets match "${search}".`}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.line}`, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Asset</th>
                <th style={th}>Serial</th>
                <th style={th}>Assigned To</th>
                <th style={th}>Status</th>
                <th style={th}>Assigned</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td style={td}>
                    <span style={{ marginRight: 6 }}>{TYPE_ICONS[a.type]}</span>
                    <span style={{ color: T.hi, fontWeight: 500 }}>{a.label}</span>
                  </td>
                  <td style={{ ...td, fontSize: 11, color: T.lo, fontFamily: "monospace" }}>{a.serialNumber ?? "—"}</td>
                  <td style={{ ...td, color: T.mid }}>{a.employee?.name ?? "Unassigned"}</td>
                  <td style={td}>
                    <Badge label={a.status} color={statusColor(a.status)} />
                  </td>
                  <td style={{ ...td, fontSize: 11, color: T.lo }}>{new Date(a.assignedAt).toLocaleDateString()}</td>
                  <td style={td}>
                    {a.status === "ASSIGNED" && (
                      <button
                        onClick={() => handleReturn(a.id)}
                        disabled={actioningId === a.id}
                        style={{
                          background: "transparent", border: `1px solid ${T.line2}`, color: T.mid,
                          borderRadius: 4, padding: "4px 10px", fontSize: 10.5, cursor: "pointer",
                          opacity: actioningId === a.id ? 0.5 : 1,
                        }}
                      >
                        Mark returned
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function statusColor(status: string): string {
  if (status === "ASSIGNED") return T.warn;
  if (status === "RETURNED") return T.success;
  if (status === "LOST") return T.danger;
  return T.lo;
}

const th: React.CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 9, fontWeight: 700, color: T.lo, textTransform: "uppercase", letterSpacing: 1, borderBottom: `1px solid ${T.line}` };
const td: React.CSSProperties = { padding: "9px 12px", fontSize: 12, borderBottom: `1px solid ${T.line}` };
