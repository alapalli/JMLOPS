"use client";

// ─────────────────────────────────────────────────────────────
// Login Page — real SSO, no dev-token workaround.
//
// Clicking either button navigates the browser directly to the
// API's OAuth start route (a plain link, not a fetch call) — the
// whole point of the OAuth redirect flow is that it's a full-page
// navigation to the provider's consent screen, not an API call.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getLoginUrl } from "../../lib/api-client";

// Only rendered if the API confirms demo mode is actually enabled server-side —
// checked at runtime below, not just a build-time env flag, so this can't
// silently render a dead button if DEMO_MODE_ENABLED isn't set on the API.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: "Something went wrong signing you in. Please try again.",
  email_not_verified: "Your Google account's email isn't verified. Please verify it and try again.",
  no_email: "We couldn't get an email address from your Microsoft account.",
  invalid_email: "That email address isn't valid for creating an account.",
  account_disabled: "This account has been disabled. Contact your admin.",
};

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [demoAvailable, setDemoAvailable] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      setErrorMessage(ERROR_MESSAGES[error] ?? "Something went wrong. Please try again.");
    }
  }, [searchParams]);

  useEffect(() => {
    // GET /auth/demo returns 204 if demo mode is on, 404 if the route was
    // never registered (demoModeEnabled false on the API) — see auth.ts.
    fetch(`${API_BASE_URL}/auth/demo`, { method: "GET" })
      .then((res) => setDemoAvailable(res.status === 204))
      .catch(() => setDemoAvailable(false));
  }, []);

  async function handleDemoLogin() {
    setDemoLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/demo`, { method: "POST", credentials: "include" });
      if (res.redirected) {
        window.location.href = res.url;
      } else if (res.ok) {
        window.location.href = "/admin";
      } else {
        setErrorMessage("Demo login is temporarily unavailable — please try again in a moment.");
      }
    } catch {
      setErrorMessage("Demo login is temporarily unavailable — please try again in a moment.");
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.kicker}>JML OPS</div>
        <h1 style={styles.title}>Sign in</h1>
        <p style={styles.subtitle}>
          Entra ID lifecycle automation — Joiner, Mover, Leaver, driven by natural language.
        </p>

        {errorMessage && <div style={styles.errorBox}>{errorMessage}</div>}

        <div style={styles.buttonGroup}>
          <a href={getLoginUrl("google")} style={styles.ssoButton}>
            <GoogleIcon />
            Continue with Google
          </a>
          <a href={getLoginUrl("microsoft")} style={styles.ssoButton}>
            <MicrosoftIcon />
            Continue with Microsoft
          </a>
        </div>

        {demoAvailable && (
          <>
            <div style={styles.divider}>
              <span style={styles.dividerLine} />
              <span style={styles.dividerText}>or</span>
              <span style={styles.dividerLine} />
            </div>
            <button onClick={handleDemoLogin} disabled={demoLoading} style={styles.demoButton}>
              {demoLoading ? "Starting demo…" : "Try the demo — no account needed"}
            </button>
            <p style={styles.demoNote}>
              Demo mode — isolated sample data, not a real account or company.
            </p>
          </>
        )}

        <p style={styles.footnote}>
          Your organization's Google Workspace or Microsoft account. The first person from a new
          company to sign in becomes that company's admin.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92C16.66 14.2 17.64 11.9 17.64 9.2z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <rect x="1" y="1" width="7.5" height="7.5" fill="#F25022"/>
      <rect x="9.5" y="1" width="7.5" height="7.5" fill="#7FBA00"/>
      <rect x="1" y="9.5" width="7.5" height="7.5" fill="#00A4EF"/>
      <rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFB900"/>
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", background: "#070B12", display: "flex",
    alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif",
  },
  card: {
    background: "#0F1626", border: "1px solid #1C2A42", borderRadius: 14,
    padding: 40, maxWidth: 380, width: "100%", textAlign: "center",
  },
  kicker: { fontFamily: "monospace", fontSize: 10, color: "#516E93", letterSpacing: 2, marginBottom: 14 },
  title: { fontSize: 24, fontWeight: 900, color: "#DCE8FF", marginBottom: 8 },
  subtitle: { fontSize: 12.5, color: "#8FA6C7", lineHeight: 1.6, marginBottom: 28 },
  errorBox: {
    background: "rgba(240,72,96,0.12)", border: "1px solid rgba(240,72,96,0.35)",
    borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#F04860", marginBottom: 20, textAlign: "left",
  },
  buttonGroup: { display: "flex", flexDirection: "column", gap: 10 },
  ssoButton: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    background: "#131C30", border: "1px solid #25384F", borderRadius: 8,
    padding: "12px 16px", fontSize: 13, fontWeight: 600, color: "#DCE8FF",
    textDecoration: "none", cursor: "pointer",
  },
  divider: { display: "flex", alignItems: "center", gap: 10, margin: "18px 0 12px" },
  dividerLine: { flex: 1, height: 1, background: "#1C2A42" },
  dividerText: { fontSize: 10.5, color: "#516E93", fontFamily: "monospace" },
  demoButton: {
    width: "100%", background: "transparent", border: "1px dashed #A78BFA",
    borderRadius: 8, padding: "12px 16px", fontSize: 12.5, fontWeight: 600,
    color: "#A78BFA", cursor: "pointer",
  },
  demoNote: { fontSize: 10, color: "#516E93", marginTop: 10, lineHeight: 1.6 },
  footnote: { fontSize: 10.5, color: "#516E93", marginTop: 24, lineHeight: 1.6 },
};
