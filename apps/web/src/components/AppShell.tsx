"use client";

// ─────────────────────────────────────────────────────────────
// AppShell — shared sidebar + top bar for every screen.
//
// THEME UPDATE: T now uses Microsoft's real, published Fluent
// Design System colors (confirmed via search, not approximated):
// #0078D4 (Microsoft blue), #107C10 (green), #FFB900 (amber),
// #D13438 (red), #323130/#FAFAFA (text/background). Light mode
// only — no dark companion, since Microsoft doesn't publish an
// official dark-theme token sheet the way it does for light.
//
// Every screen imports T from here, so this single change is
// what actually re-themes the whole app — individual screen
// files should never hardcode hex colors directly; if you find
// one that does, it's a real gap this refactor should also fix.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, type CurrentUser } from "../lib/api-client";

export const T = {
  base:    "#FAF9F8",
  surface: "#FFFFFF",
  card:    "#FFFFFF",
  cardAlt: "#F3F2F1",
  raise:   "#F3F2F1",
  line:    "#EDEBE9",
  line2:   "#D2D0CE",

  hi:   "#201F1E",
  mid:  "#323130",
  lo:   "#605E5C",
  inv:  "#FFFFFF",

  claude:  "#0078D4", // Microsoft blue — real Fluent primary, used as the brand/active accent
  local:   "#5C2D91", // real Fluent purple
  success: "#107C10", // real Fluent green
  warn:    "#FFB900", // real Fluent amber
  danger:  "#D13438", // real Fluent red
  info:    "#0078D4",

  claudeBg:  "rgba(0,120,212,0.09)",
  localBg:   "rgba(92,45,145,0.09)",
  successBg: "rgba(16,124,16,0.09)",
  warnBg:    "rgba(255,185,0,0.14)", // amber needs a bit more opacity to stay legible on white
  dangerBg:  "rgba(209,52,56,0.09)",
  infoBg:    "rgba(0,120,212,0.09)",

  shadow: "0 1.6px 3.6px rgba(0,0,0,0.11), 0 0.3px 0.9px rgba(0,0,0,0.07)", // real Fluent elevation value
};

const NAV = [
  { icon: "\ud83d\ude4b", label: "My Requests", href: "/my-requests" },
  { icon: "\u26a1", label: "Prompt Console", href: "/prompt" },
  { icon: "\ud83d\udc65", label: "Employees", href: "/employees" },
  { icon: "\ud83d\udcbb", label: "Assets", href: "/assets" },
  { icon: "\ud83d\udcdd", label: "Change Requests", href: "/requests" },
  { icon: "\ud83d\udfe2", label: "Joiner", href: "/joiner" },
  { icon: "\ud83d\udfe1", label: "Mover", href: "/mover" },
  { icon: "\ud83d\udd34", label: "Leaver", href: "/leaver" },
  { icon: "\ud83d\uddc2\ufe0f", label: "Access Review", href: "/access" },
  { icon: "\ud83d\udcca", label: "AI Analytics", href: "/analytics" },
  { icon: "\u2699\ufe0f", label: "Model Config", href: "/config" },
  { icon: "\ud83d\udccb", label: "Audit Log", href: "/audit" },
];

export function StatusDot({ status }: { status: "active" | "pending" | "failed" | "idle" | "running" }) {
  const map: Record<string, string> = {
    active: T.success, pending: T.warn, failed: T.danger, idle: T.lo, running: T.claude,
  };
  return (
    <span
      style={{
        display: "inline-block", width: 7, height: 7, borderRadius: "50%",
        background: map[status] ?? T.lo,
        boxShadow: status === "running" ? `0 0 5px ${T.claude}` : "none",
        flexShrink: 0,
      }}
    />
  );
}

export function Tag({ label, color = T.info }: { label: string; color?: string }) {
  return (
    <span
      style={{
        background: color + "16", color, border: `1px solid ${color}30`,
        borderRadius: 3, padding: "2px 8px", fontSize: 11, fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-block", fontSize: 10, fontWeight: 600, color,
        background: color + "16", border: `1px solid ${color}30`,
        borderRadius: 3, padding: "3px 8px", letterSpacing: 0.2, textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

function Sidebar() {
  const pathname = usePathname();
  return (
    <div
      style={{
        width: 210, background: T.surface, borderRight: `1px solid ${T.line}`,
        display: "flex", flexDirection: "column", flexShrink: 0, height: "100vh",
        position: "sticky", top: 0,
      }}
    >
      <div style={{ padding: "18px 18px 14px", borderBottom: `1px solid ${T.line}` }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.hi, letterSpacing: -0.2 }}>
          <span style={{ color: T.claude }}>JML</span> Ops
        </div>
        <div style={{ fontSize: 10, color: T.lo, marginTop: 2 }}>Workplace Automation</div>
      </div>
      <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
        {NAV.map((n) => {
          const active = pathname === n.href;
          return (
            <Link
              key={n.href}
              href={n.href}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "9px 18px", background: active ? T.claude + "10" : "transparent",
                textDecoration: "none", borderLeft: active ? `3px solid ${T.claude}` : "3px solid transparent",
                color: active ? T.claude : T.mid, fontSize: 13, fontWeight: active ? 600 : 400,
              }}
            >
              <span style={{ fontSize: 14 }}>{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function TopBar({ title, sub, currentUser, onLogout }: { title: string; sub?: string | undefined; currentUser: CurrentUser | null; onLogout: () => void }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 28px", height: 56, borderBottom: `1px solid ${T.line}`,
        background: T.surface, position: "sticky", top: 0, zIndex: 10,
      }}
    >
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.hi }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: T.lo, marginTop: 1 }}>{sub}</div>}
      </div>
      {currentUser && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {currentUser.avatarUrl && (
            <img src={currentUser.avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: "50%" }} />
          )}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.hi }}>{currentUser.name}</div>
            <div style={{ fontSize: 10, color: T.lo }}>{currentUser.role}</div>
          </div>
          <button
            onClick={onLogout}
            style={{
              background: T.raise, border: `1px solid ${T.line2}`, color: T.danger,
              borderRadius: 3, padding: "6px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", marginLeft: 8,
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Wrap every screen's page component in this. Handles the shared
 * auth check + logout (same pattern already proven in the real
 * Admin/Prompt pages), sidebar, and top bar — screens only need to
 * provide their own content as children.
 */
export function AppShell({ title, sub, children }: { title: string; sub?: string | undefined; children: ReactNode }) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    api.getCurrentUser().then(setCurrentUser).catch(() => router.replace("/login"));
  }, [router]);

  async function handleLogout() {
    await api.logout();
    router.replace("/login");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: T.base, fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar title={title} sub={sub} currentUser={currentUser} onLogout={handleLogout} />
        <div style={{ flex: 1, padding: 24, overflowX: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}
