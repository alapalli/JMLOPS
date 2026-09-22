// ─────────────────────────────────────────────────────────────
// @jml-ops/api — Auth Plugin (Google + Microsoft SSO)
//
// Architecture: OAuth2 (Google/Microsoft) verifies WHO the person is,
// once, at login. After that verification succeeds, we issue our OWN
// signed JWT session token — everything downstream (route protection,
// WebSocket auth, etc.) only ever deals with that JWT, never with
// provider tokens. This keeps the rest of the app provider-agnostic
// and means a provider's token expiry/refresh semantics never leak
// into our own session lifetime.
//
// Flow:
//   1. GET /auth/google/login or /auth/microsoft/login
//      -> redirects to the provider's consent screen
//   2. Provider redirects back to /auth/{provider}/callback with a code
//   3. We exchange the code for an access token (handled by the plugin)
//   4. We call the provider's userinfo endpoint to get verified identity
//   5. We find-or-create a User row keyed on (authProvider, providerAccountId)
//      — NOT on email alone, see schema.prisma comment for why
//   6. We issue our own JWT, set it as an httpOnly cookie, redirect to the app
// ─────────────────────────────────────────────────────────────

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyOauth2, { type OAuth2Namespace } from "@fastify/oauth2";
import { prisma } from "@jml-ops/db";

// Minimal shapes of each provider's userinfo response — only the fields
// we actually read. @fastify/oauth2's userinfo() is typed to return a
// generic Object since the shape varies per provider; we narrow it here.
interface GoogleUserinfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

interface MicrosoftUserinfo {
  id: string;
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
}

const JWT_SECRET_RAW = process.env.JWT_SECRET;
if (!JWT_SECRET_RAW) {
  throw new Error("JWT_SECRET is not set — refusing to start.");
}
const JWT_SECRET: string = JWT_SECRET_RAW;

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — required for SSO login. See .env.example.`);
  }
  return value;
}

declare module "fastify" {
  interface FastifyInstance {
    googleOAuth2: OAuth2Namespace;
    microsoftOAuth2: OAuth2Namespace;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: "jml_session", signed: false },
  });

  const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const microsoftConfigured = !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);

  if (!googleConfigured && !microsoftConfigured) {
    throw new Error(
      "Neither Google nor Microsoft SSO is configured — at least one is required. " +
      "Set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET and/or MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET. " +
      "See .env.example."
    );
  }

  // ── Google OAuth2 (only registered if configured) ─────────────
  if (googleConfigured) {
    await app.register(fastifyOauth2, {
      name: "googleOAuth2",
      scope: ["profile", "email"],
      credentials: {
        client: {
          id: requireEnv("GOOGLE_CLIENT_ID"),
          secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        },
        auth: fastifyOauth2.GOOGLE_CONFIGURATION,
      },
      startRedirectPath: "/auth/google/login",
      callbackUri: `${API_ORIGIN}/auth/google/callback`,
      pkce: "S256",
    });
  } else {
    app.log.warn("Google SSO not configured (GOOGLE_CLIENT_ID/SECRET missing) — /auth/google/* routes disabled");
  }

  // ── Microsoft OAuth2 (only registered if configured — multi-tenant,
  // works for any Entra tenant, not just one company's own directory,
  // since JML Ops is multi-tenant SaaS and different customer companies
  // will use different Entra tenants for THEIR employees logging into
  // JML Ops itself) ───────────────────────────────────────────────
  if (microsoftConfigured) {
    await app.register(fastifyOauth2, {
      name: "microsoftOAuth2",
      scope: ["openid", "profile", "email", "User.Read"],
      credentials: {
        client: {
          id: requireEnv("MICROSOFT_CLIENT_ID"),
          secret: requireEnv("MICROSOFT_CLIENT_SECRET"),
        },
        auth: fastifyOauth2.MICROSOFT_CONFIGURATION,
      },
      startRedirectPath: "/auth/microsoft/login",
      callbackUri: `${API_ORIGIN}/auth/microsoft/callback`,
      pkce: "S256",
    });
  } else {
    app.log.warn("Microsoft SSO not configured (MICROSOFT_CLIENT_ID/SECRET missing) — /auth/microsoft/* routes disabled");
  }

  // ── Callback handlers (only registered for configured providers —
  // app.googleOAuth2 / app.microsoftOAuth2 wouldn't exist otherwise) ──

  if (googleConfigured) {
  app.get("/auth/google/callback", async (request, reply) => {
    try {
      const { token } = await app.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      const userinfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!userinfoResponse.ok) {
        throw new Error(`Google userinfo request failed with status ${userinfoResponse.status}`);
      }
      const userinfo = (await userinfoResponse.json()) as GoogleUserinfo;

      if (!userinfo.email_verified) {
        return reply.redirect(`${WEB_ORIGIN}/login?error=email_not_verified`);
      }

      await completeSsoLogin(reply, {
        authProvider: "GOOGLE",
        providerAccountId: userinfo.sub,
        email: userinfo.email,
        name: userinfo.name ?? userinfo.email,
        ...(userinfo.picture ? { avatarUrl: userinfo.picture } : {}),
      });
    } catch (err) {
      app.log.error({ err }, "Google OAuth callback failed");
      return reply.redirect(`${WEB_ORIGIN}/login?error=oauth_failed`);
    }
  });
  }

  if (microsoftConfigured) {
  app.get("/auth/microsoft/callback", async (request, reply) => {
    try {
      const { token } = await app.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      const userinfo = (await app.microsoftOAuth2.userinfo(token.access_token, {
        // Microsoft Graph's /me endpoint is the standard userinfo source —
        // the plugin's default provider config already points here.
        method: "GET",
      })) as MicrosoftUserinfo;

      const email = userinfo.mail ?? userinfo.userPrincipalName;
      if (!email) {
        return reply.redirect(`${WEB_ORIGIN}/login?error=no_email`);
      }

      await completeSsoLogin(reply, {
        authProvider: "MICROSOFT",
        providerAccountId: userinfo.id,
        email,
        name: userinfo.displayName ?? email,
        // MS Graph photo requires a separate binary endpoint call — skip for v1,
        // simply omit the field rather than assigning undefined explicitly
        // (exactOptionalPropertyTypes treats those differently).
      });
    } catch (err) {
      app.log.error({ err }, "Microsoft OAuth callback failed");
      return reply.redirect(`${WEB_ORIGIN}/login?error=oauth_failed`);
    }
  });
  }

  // ── Demo access (no SSO) ────────────────────────────────────
  // For conference/booth use ONLY — lets a visitor without their own
  // Google/Microsoft account try the product. Explicitly opt-in via
  // DEMO_MODE_ENABLED — never on by default, so this can't accidentally
  // ship live for a real customer deployment. Issues the exact same
  // session cookie as a real SSO login (via completeSsoLogin below) —
  // no new auth mechanism, no passwords stored anywhere.
  //
  // Reuses the existing GOOGLE/MICROSOFT AuthProvider enum values rather
  // than adding a third DEMO value — deliberately avoids a schema
  // migration for a conference-scoped feature. The fixed providerAccountId
  // below keys to one single, dedicated demo user every time.
  const demoModeEnabled = process.env.DEMO_MODE_ENABLED === "true";

  // Minimal in-memory throttle — deliberately not a full rate-limit package,
  // since this is a conference-scoped feature, not permanent infrastructure.
  // Resets on server restart, which is fine for this use case.
  let demoLoginCount = 0;
  let demoWindowStart = Date.now();
  const DEMO_MAX_PER_MINUTE = 20;

  if (demoModeEnabled) {
    // Separate GET route purely so the frontend can check availability —
    // a HEAD request against the POST-only /auth/demo route below would
    // always 404 regardless of demoModeEnabled, since Fastify routes are
    // registered per-method. This avoids that false negative.
    app.get("/auth/demo", async (_request, reply) => {
      return reply.code(204).send();
    });

    app.post("/auth/demo", async (request, reply) => {
      const now = Date.now();
      if (now - demoWindowStart > 60_000) {
        demoWindowStart = now;
        demoLoginCount = 0;
      }
      demoLoginCount++;
      if (demoLoginCount > DEMO_MAX_PER_MINUTE) {
        return reply.code(429).send({ error: "Too many demo login attempts — please wait a moment." });
      }

      await completeSsoLogin(reply, {
        authProvider: "GOOGLE",
        providerAccountId: "demo-booth-user-fixed-id",
        email: "demo@vantrazero-demo.example",
        name: "Demo User",
      });
    });
  }

  async function completeSsoLogin(
    reply: FastifyReply,
    identity: { authProvider: "GOOGLE" | "MICROSOFT"; providerAccountId: string; email: string; name: string; avatarUrl?: string }
  ) {
    // Find existing user by verified provider identity (not email — see schema comment).
    let user = await prisma.user.findUnique({
      where: { authProvider_providerAccountId: { authProvider: identity.authProvider, providerAccountId: identity.providerAccountId } },
    });

    if (!user) {
      // No existing account for this provider identity. Find-or-create the
      // company by email domain, then create the user as the company's
      // first admin if the company is new, or a regular member if not.
      const domain = identity.email.split("@")[1];
      if (!domain) {
        return reply.redirect(`${WEB_ORIGIN}/login?error=invalid_email`);
      }

      let company = await prisma.company.findUnique({ where: { domain } });
      const isNewCompany = !company;

      if (!company) {
        company = await prisma.company.create({
          data: {
            name: domain.split(".")[0] ?? domain,
            domain,
            slug: domain.replace(/\./g, "-"),
            plan: "STARTER",
            country: "DE",
            dataRegion: "eu-central-1",
          },
        });
      }

      user = await prisma.user.create({
        data: {
          companyId: company.id,
          email: identity.email,
          name: identity.name,
          ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
          authProvider: identity.authProvider,
          providerAccountId: identity.providerAccountId,
          role: isNewCompany ? "ADMIN" : "IT_MANAGER",
        },
      });
    } else if (!user.isActive) {
      return reply.redirect(`${WEB_ORIGIN}/login?error=account_disabled`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const sessionToken = await reply.jwtSign({
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
    });

    reply.setCookie("jml_session", sessionToken, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return reply.redirect(`${WEB_ORIGIN}/admin`);
  }

  app.post("/auth/logout", async (request, reply) => {
    reply.clearCookie("jml_session", { path: "/" });
    return reply.send({ success: true });
  });

  // ── Session verification decorator — MUST be registered before any
  // route below references it as a preHandler, since Fastify route
  // registration happens synchronously as this function executes. ──
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const decoded = await request.jwtVerify<{ userId: string; companyId: string; role: string }>();

      const user = await prisma.user.findFirst({
        where: { id: decoded.userId, companyId: decoded.companyId, isActive: true },
      });

      if (!user) {
        return reply.code(401).send({ error: "User no longer active" });
      }

      request.user = { ...decoded, role: user.role };
    } catch (err) {
      return reply.code(401).send({ error: "Invalid or expired session" });
    }
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.userId } });
    if (!user) return reply.code(404).send({ error: "User not found" });
    return reply.send({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      companyId: user.companyId,
    });
  });

  // Apply auth to all /api/* routes except health check and the
  // auth/login/callback routes themselves (which must be reachable
  // without an existing session — that's the whole point).
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health" || request.url.startsWith("/health")) return;
    if (request.url.startsWith("/auth/")) return;
    if (request.url.startsWith("/api/")) {
      await (app as any).authenticate(request, reply);
    }
  });
}
