#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// JML Ops · Dev Environment Setup Script
// Run: node infra/scripts/setup.mjs
// ─────────────────────────────────────────────────────────────

import { execSync } from "child_process";
import { existsSync, copyFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

function run(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: opts.silent ? "pipe" : "inherit", cwd: ROOT, ...opts });
    return true;
  } catch (e) {
    if (opts.optional) return false;
    console.error(c.red(`  ✗ Failed: ${cmd}`));
    if (opts.fatal !== false) process.exit(1);
    return false;
  }
}

function step(n, total, label) {
  console.log(`\n${c.cyan(`[${n}/${total}]`)} ${c.bold(label)}`);
}

function ok(msg)   { console.log(c.green(`  ✓ ${msg}`)); }
function warn(msg) { console.log(c.yellow(`  ⚠ ${msg}`)); }
function info(msg) { console.log(c.dim(`  → ${msg}`)); }

// ─────────────────────────────────────────────────────────────
console.log(c.bold("\n⚡ JML Ops — Dev Environment Setup\n"));

const STEPS = 9;

// ── 1. Node version check ────────────────────────────────────
step(1, STEPS, "Checking prerequisites");
const nodeVer = process.versions.node.split(".")[0];
if (parseInt(nodeVer) < 22) {
  console.error(c.red(`  ✗ Node 22+ required (found ${process.version}). Install: nvm use 22`));
  process.exit(1);
}
ok(`Node ${process.version}`);

const hasPnpm = run("pnpm --version", { silent: true, optional: true });
if (!hasPnpm) {
  warn("pnpm not found — installing via corepack");
  run("corepack enable && corepack prepare pnpm@latest --activate");
}
ok("pnpm available");

const hasDocker = run("docker info", { silent: true, optional: true });
if (!hasDocker) {
  console.error(c.red("  ✗ Docker not running. Start Docker Desktop and retry."));
  process.exit(1);
}
ok("Docker running");

const hasOllama = run("ollama --version", { silent: true, optional: true });
if (!hasOllama) {
  warn("Ollama not found. Install from https://ollama.com and re-run.");
  warn("Local AI models will not be available until Ollama is running.");
} else {
  ok("Ollama available");
}

// ── 2. Copy .env ─────────────────────────────────────────────
step(2, STEPS, "Environment variables");
const envPath    = join(ROOT, ".env");
const envExample = join(ROOT, "infra/dev/.env.example");

if (!existsSync(envPath)) {
  copyFileSync(envExample, envPath);
  ok("Created .env from .env.example");
  warn("Open .env and set ANTHROPIC_API_KEY before starting");
} else {
  ok(".env already exists — skipping");
  info("To reset: rm .env && pnpm setup");
}

// ── 3. Install dependencies ──────────────────────────────────
step(3, STEPS, "Installing dependencies");
run("pnpm install");
ok("Dependencies installed");

// ── 4. Start Docker services ─────────────────────────────────
step(4, STEPS, "Starting Docker services");
run("docker compose -f infra/dev/docker-compose.yml up -d --wait");
ok("All services healthy");
info("PostgreSQL  → localhost:5432");
info("Redis       → localhost:6379");
info("LiteLLM     → http://localhost:4002");
info("Mailpit UI  → http://localhost:8025");
info("Adminer     → http://localhost:8080");
info("Redis UI    → http://localhost:8081");

// ── 5. Wait for PostgreSQL ────────────────────────────────────
step(5, STEPS, "Waiting for PostgreSQL");
let pgReady = false;
for (let i = 0; i < 20; i++) {
  pgReady = run(
    `docker exec jmlops-postgres pg_isready -U dev -d jmlops`,
    { silent: true, optional: true }
  );
  if (pgReady) break;
  await new Promise(r => setTimeout(r, 1000));
}
if (!pgReady) {
  console.error(c.red("  ✗ PostgreSQL didn't become ready. Check: docker logs jmlops-postgres"));
  process.exit(1);
}
ok("PostgreSQL ready");

// ── 6. Run Prisma migrations ─────────────────────────────────
step(6, STEPS, "Running database migrations");
run("pnpm --filter @jml-ops/db migrate:dev --name init");
ok("Migrations applied");

// ── 7. Database ready for use ─────────────────────────────────
step(7, STEPS, "Database migrated — connector seeding happens after first login");
info("Sign in via SSO first (creates your company + admin user automatically),");
info("then run 'pnpm db:seed' with SEED_COMPANY_DOMAIN + Entra credentials set");
info("in .env to activate the Entra connector for your real company.");

// ── 8. Pull Ollama models ─────────────────────────────────────
step(8, STEPS, "Pulling Ollama models (this may take a while...)");
if (hasOllama) {
  const models = [
    ["mistral",          "Fast classify — 4.1GB"],
    ["nomic-embed-text", "Embeddings — 274MB"],
  ];
  for (const [model, note] of models) {
    info(`Pulling ${model} (${note})`);
    run(`ollama pull ${model}`, { fatal: false });
    ok(`${model} ready`);
  }
  info("Larger models (qwen2.5:27b, deepseek-r1:14b) — pull manually when needed:");
  info("  ollama pull qwen2.5:27b      # 17GB — needed for GDPR/PII routing");
  info("  ollama pull deepseek-r1:14b  # 9GB  — needed for root cause analysis");
} else {
  warn("Skipping — Ollama not installed");
}

// ── 9. Summary ────────────────────────────────────────────────
step(9, STEPS, "Setup complete!");
console.log(`
${c.green("━".repeat(58))}
${c.bold("  JML Ops dev environment is ready.")}

  ${c.cyan("Start all services:")}
    pnpm dev

  ${c.cyan("Service URLs:")}
    🌐 Frontend   → http://localhost:3000
    ⚡ API        → http://localhost:4000
    🤖 LiteLLM   → http://localhost:4002
    🐘 Adminer   → http://localhost:8080
    📧 Mailpit   → http://localhost:8025

  ${c.dim("(Bull Board queue UI is not implemented in v0.1 — inspect jobs via")}
  ${c.dim(" the Admin screen's Jobs tab, or 'pnpm db:studio' for raw DB access)")}

  ${c.cyan("Useful commands:")}
    pnpm infra:logs   — tail all Docker logs
    pnpm infra:reset  — wipe Docker volumes and restart fresh
    pnpm db:studio    — open Prisma Studio
    pnpm db:seed      — activate a connector for your company (needs SEED_COMPANY_DOMAIN)

  ${c.yellow("Next steps:")}
    1. Open .env and set ANTHROPIC_API_KEY, ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET
    2. Set GOOGLE_CLIENT_ID/SECRET and/or MICROSOFT_CLIENT_ID/SECRET for SSO login
       (see .env.example for where to register these with each provider)
    3. pnpm dev
    4. Open http://localhost:3000 — you'll be redirected to /login automatically
    5. Sign in with Google or Microsoft — first person from a new company
       becomes that company's admin (this creates your company in the DB)
    6. Set SEED_COMPANY_DOMAIN in .env to the domain of the email you just
       signed in with, then run: pnpm db:seed   (activates the Entra connector)
${c.green("━".repeat(58))}
`);
