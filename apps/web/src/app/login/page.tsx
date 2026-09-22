"use client";
// ─────────────────────────────────────────────────────────────
// Login Page — real SSO, no dev-token workaround.
//
// THEME: styles object matches the Fluent/Entra light theme used
// everywhere else in the app (see AppShell.tsx T object). The
// Google and Microsoft brand icon colors below are left untouched
// — those are real, fixed external brand colors, not part of our
// app's theme.
//
// Suspense boundary requirement: useSearchParams() must stay
// wrapped, or the page fails to prerender at build time (Next.js
// 14 App Router requirement).
// ─────────────────────────────────────────────────────────────
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getLoginUrl } from "../../lib/api-client";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: "Something went wrong signing you in. Please try again.",
  email_not_verified: "Your Google account's email isn't verified. Please verify it and try again.",
  no_email: "We couldn't get an email address from your Microsoft account.",
  invalid_email: "That email address isn't valid for creating an account.",
  account_disabled: "This account has been disabled. Contact your admin.",
};

function LoginContent() {
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
        <div style={styles.brand}>JML OPS</div>
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
          Your organization&apos;s Google Workspace or Microsoft account. The first person from a
          new company to sign in becomes that company&apos;s admin.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={styles.page} />}>
      <LoginContent />
    </Suspense>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.63z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <rect x="0" y="0" width="8.5" height="8.5" fill="#F25022" />
      <rect x="9.5" y="0" width="8.5" height="8.5" fill="#7FBA00" />
      <rect x="0" y="9.5" width="8.5" height="8.5" fill="#00A4EF" />
      <rect x="9.5" y="9.5" width="8.5" height="8.5" fill="#FFB900" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#FAF9F8", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  },
  card: {
    background: "#FFFFFF", border: "1px solid #EDEBE9", borderRadius: 4,
    padding: "40px 36px", maxWidth: 420, width: "100%", textAlign: "center",
    boxShadow: "0 1.6px 3.6px rgba(0,0,0,0.11), 0 0.3px 0.9px rgba(0,0,0,0.07)",
  },
  brand: { fontSize: 11, fontWeight: 600, letterSpacing: 2.5, color: "#605E5C", marginBottom: 16 },
  title: { fontSize: 26, fontWeight: 600, color: "#201F1E", marginBottom: 10 },
  subtitle: { fontSize: 13, color: "#605E5C", lineHeight: 1.6, marginBottom: 28 },
  errorBox: {
    background: "rgba(209,52,56,0.09)", border: "1px solid rgba(209,52,56,0.3)",
    borderRadius: 4, padding: "12px 16px", fontSize: 12.5, color: "#D13438", marginBottom: 20,
  },
  buttonGroup: { display: "flex", flexDirection: "column", gap: 10 },
  ssoButton: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    background: "#FFFFFF", border: "1px solid #D2D0CE", borderRadius: 4,
    padding: "12px 16px", fontSize: 13, fontWeight: 600, color: "#201F1E",
    textDecoration: "none", cursor: "pointer",
  },
  divider: { display: "flex", alignItems: "center", gap: 10, margin: "18px 0 12px" },
  dividerLine: { flex: 1, height: 1, background: "#EDEBE9" },
  dividerText: { fontSize: 10.5, color: "#605E5C", fontFamily: "Consolas, monospace" },
  demoButton: {
    width: "100%", background: "transparent", border: "1px dashed #5C2D91",
    borderRadius: 4, padding: "12px 16px", fontSize: 12.5, fontWeight: 600,
    color: "#5C2D91", cursor: "pointer",
  },
  demoNote: { fontSize: 10, color: "#605E5C", marginTop: 10, lineHeight: 1.6 },
  footnote: { fontSize: 10.5, color: "#605E5C", marginTop: 24, lineHeight: 1.6 },
};
