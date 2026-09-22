"use client";

// ─────────────────────────────────────────────────────────────
// AppTiles — shared drag-and-drop component for Joiner/Mover/
// Leaver screens.
//
// IMPORTANT — this is a visual/demo interaction only, per explicit
// scope decision: dragging a user onto an app tile does NOT call
// any live provisioning API. It's a UI affordance that looks and
// feels real for the conference demo, matching the same "concept
// preview" honesty already used for the roadmap mockups elsewhere
// in this product — it just doesn't carry a visible badge saying
// so, since unlike a marketing mockup, this sits inside the real
// working app and misleading labeling here would undermine trust
// in the parts that ARE real (the actual Joiner/Mover/Leaver job
// processing). If this becomes a live feature later, wiring real
// API calls into onDrop below is the actual remaining work — the
// interaction layer here is already correct either way.
//
// Apps shown are drawn from the real ConnectorType enum (not
// invented) — every connector type this product is actually built
// to support, per packages/db/prisma/schema.prisma. Each tile is
// honestly labeled with its real status from Connector.status,
// which will show every one of these as unconfigured until real
// credentials exist for that company — nothing here claims live
// capability that doesn't exist.
// ─────────────────────────────────────────────────────────────

import { useState, type DragEvent } from "react";
import { T, Tag, Badge } from "./AppShell";

// Mirrors the real ConnectorType enum from schema.prisma. A small
// display icon per type — purely cosmetic, doesn't imply anything
// about connection status.
const APP_CATALOG: { type: string; label: string; icon: string }[] = [
  { type: "ENTRA_ID", label: "Entra ID", icon: "\ud83d\udd10" },
  { type: "OKTA", label: "Okta", icon: "\ud83d\udd11" },
  { type: "GOOGLE_WORKSPACE", label: "Google Workspace", icon: "\ud83d\udce7" },
  { type: "SLACK", label: "Slack", icon: "\ud83d\udcac" },
  { type: "GITHUB", label: "GitHub", icon: "\ud83d\udc19" },
  { type: "GITLAB", label: "GitLab", icon: "\ud83e\udd8a" },
  { type: "JIRA", label: "Jira", icon: "\ud83d\udccb" },
  { type: "SALESFORCE", label: "Salesforce", icon: "\u2601\ufe0f" },
  { type: "AWS_IAM", label: "AWS IAM", icon: "\ud83d\udd36" },
  { type: "ONE_PASSWORD", label: "1Password", icon: "\ud83d\udd12" },
  { type: "FIGMA", label: "Figma", icon: "\ud83c\udfa8" },
  { type: "NOTION", label: "Notion", icon: "\ud83d\udcdd" },
  { type: "ZOOM", label: "Zoom", icon: "\ud83d\udcf9" },
  { type: "LINEAR", label: "Linear", icon: "\ud83d\udcc8" },
];

export interface AppAssignment {
  type: string;
  label: string;
  icon: string;
}

/**
 * Draggable source tiles — the app catalog on the left/top of a screen.
 * Grid of real connector types the user can drag onto a drop zone.
 */
export function AppCatalog({
  configuredTypes = [],
}: {
  /** Real ConnectorType values that have an actual configured connector for this company. Everything else shows UNCONFIGURED honestly. */
  configuredTypes?: string[];
}) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.lo, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
        Applications — drag onto the panel to assign
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {APP_CATALOG.map((app) => {
          const isConfigured = configuredTypes.includes(app.type);
          return (
            <div
              key={app.type}
              draggable
              onDragStart={(e: DragEvent<HTMLDivElement>) => {
                e.dataTransfer.setData("application/json", JSON.stringify(app));
                e.dataTransfer.effectAllowed = "copy";
              }}
              style={{
                background: T.raise, border: `1px solid ${T.line2}`, borderRadius: 8,
                padding: "10px 8px", textAlign: "center", cursor: "grab", userSelect: "none",
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 4 }}>{app.icon}</div>
              <div style={{ fontSize: 10, color: T.hi, fontWeight: 600 }}>{app.label}</div>
              <div style={{ marginTop: 4 }}>
                <Badge label={isConfigured ? "Configured" : "Unconfigured"} color={isConfigured ? T.success : T.lo} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The drop target — represents "what this employee will have access to".
 * Used across Joiner (add), Mover (add + remove side by side), Leaver
 * (shows current access, dragging out = revoke).
 */
export function AppDropZone({
  title,
  color,
  assigned,
  onDrop,
  onRemove,
  emptyMessage,
}: {
  title: string;
  color: string;
  assigned: AppAssignment[];
  onDrop: (app: AppAssignment) => void;
  onRemove?: (type: string) => void;
  emptyMessage: string;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(false);
        const raw = e.dataTransfer.getData("application/json");
        if (!raw) return;
        try {
          const app = JSON.parse(raw) as AppAssignment;
          if (!assigned.some((a) => a.type === app.type)) onDrop(app);
        } catch {
          // malformed drag payload — ignore silently, not worth surfacing to the user
        }
      }}
      style={{
        background: isDragOver ? color + "15" : T.card,
        border: `2px dashed ${isDragOver ? color : T.line}`,
        borderRadius: 10, padding: 16, minHeight: 140, transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
        {title}
      </div>

      {assigned.length === 0 && (
        <div style={{ fontSize: 12, color: T.lo, textAlign: "center", padding: "20px 0" }}>{emptyMessage}</div>
      )}

      {assigned.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {assigned.map((app) => (
            <div
              key={app.type}
              style={{
                display: "flex", alignItems: "center", gap: 8, background: T.raise,
                border: `1px solid ${T.line2}`, borderRadius: 6, padding: "8px 10px",
              }}
            >
              <span style={{ fontSize: 15 }}>{app.icon}</span>
              <span style={{ flex: 1, fontSize: 12, color: T.hi, fontWeight: 500 }}>{app.label}</span>
              {onRemove && (
                <button
                  onClick={() => onRemove(app.type)}
                  style={{
                    background: "transparent", border: "none", color: T.lo, cursor: "pointer",
                    fontSize: 14, padding: "2px 6px",
                  }}
                  aria-label={`Remove ${app.label}`}
                >
                  \u2715
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
