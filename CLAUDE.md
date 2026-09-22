# JML Ops — CLAUDE.md
# Claude Code reads this at the start of EVERY session.
# Update "Today's Tasks" each morning before opening a terminal.
# Log every architectural decision in "Decisions Made" immediately.

## Project
JML Ops — AI-powered employee lifecycle automation (Joiner / Mover / Leaver)
SaaS B2B product targeting 50–500 person companies in Germany and India.

## Stack
- **Frontend**:  Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui
- **API**:       Fastify 5, TypeScript, Zod, JWT auth
- **Worker**:    BullMQ + Node.js 22, 4 queues
- **AI**:        LiteLLM proxy (port 4002) → Claude API + Ollama local
- **Database**:  PostgreSQL 16 + pgvector + TimescaleDB, Prisma ORM
- **Cache/Queue**:Redis 7 (BullMQ + pub/sub + LiteLLM cache)
- **Infra (dev)**:Docker Compose (9 services)
- **Infra (prod)**:Hetzner VPS (Germany) + GCP europe-west3

## Monorepo (pnpm + Turborepo)
```
apps/
  api/      → Fastify 5 REST + WebSocket (port 4000)
  worker/   → BullMQ processors + Bull Board (port 4001)
  web/      → Next.js 14 App Router (port 3000)
packages/
  db/       → Prisma schema + migrations (SINGLE SOURCE OF TRUTH)
  shared/   → Zod schemas + TypeScript types (shared by all apps)
infra/
  dev/      → docker-compose.yml, init.sql, litellm.yaml, .env.example
  prod/     → docker-compose.prod.yml, nginx.conf, deploy scripts
  scripts/  → setup.mjs, seed.ts, ollama-pull.sh
```

## HARD RULES — Never violate these

1. **All DB queries via Prisma** — NO raw SQL except in migration files
2. **audit_log is APPEND-ONLY** — never write UPDATE or DELETE on it
3. **All AI calls via LiteLLM at :4002** — never call Anthropic API directly
4. **Okta/Entra MUST be suspended FIRST** in all LEAVER flows, then wait 2s
5. **Zod schemas in packages/shared** — never duplicate type definitions in apps
6. **Every provisioning action MUST write to audit_log** with HMAC-SHA256
7. **LEAVER revocation order**: IdP (Okta/Entra) → GitHub/AWS → Salesforce → Slack → others → Sentinel
8. **JSM ticket**: auto-create on JOINER/LEAVER start, auto-close on completion
9. **No raw secrets in code** — all via process.env, validated at startup with Zod
10. **Multi-tenant isolation**: always include companyId in every DB query, enforced by RLS

## Current Phase
[ UPDATE DAILY — e.g. "Week 1 · Day 3 — Setting up API routes" ]

## Today's Tasks
[ FILL IN EACH MORNING before starting Claude Code ]
1.
2.
3.

## Service Ports (dev)
| Service         | Port  | URL                          |
|-----------------|-------|------------------------------|
| Next.js web     | 3000  | http://localhost:3000        |
| Fastify API     | 4000  | http://localhost:4000        |
| Bull Board      | 4001  | http://localhost:4001/ui     |
| LiteLLM proxy   | 4002  | http://localhost:4002        |
| PostgreSQL      | 5432  | postgresql://dev:dev@localhost:5432/jmlops |
| Redis           | 6379  | redis://localhost:6379       |
| Ollama          | 11434 | http://localhost:11434       |
| Adminer (DB UI) | 8080  | http://localhost:8080        |
| Redis UI        | 8081  | http://localhost:8081        |
| Mailpit (email) | 8025  | http://localhost:8025        |

## AI Model Routing
| Task                        | Model          | Why                     |
|-----------------------------|----------------|-------------------------|
| Intent classify (real-time) | mistral-7b     | 95ms, local, free       |
| JML deep parsing            | claude-sonnet  | Best accuracy            |
| PII-sensitive parsing       | qwen-27b       | Local, GDPR-safe        |
| Slack bot responses         | claude-haiku   | 180ms, cheap            |
| Root cause analysis         | deepseek-r1    | Chain-of-thought local  |
| RAG embeddings              | nomic-embed    | Local, pgvector          |
| SOC 2 / compliance reports  | claude-opus    | 200K context            |

Route via header: `x-data-sensitivity: high` forces local model (Qwen 27B).

## LEAVER Revocation Order (CRITICAL)
```typescript
// MUST follow this order — never change without explicit decision log
1. revokeSignInSessions(entraId)    // Instant SSO block
2. scimDeprovision(entraId)         // Cascades M365/Teams/SharePoint
3. github.removeFromOrg()           // Security risk
4. aws.deleteAccessKeys()           // Security risk
5. salesforce.deactivateUser()      // Data retention
6. slack.scimDeprovision()          // Message history preserved
7. jira.removeFromProjects()        // Operational
8. sap.deactivateUser()             // SAP apps blocked
9. sentinel.writeEvent()            // Audit (always last)
10. auditLog.write(hmac)            // Immutable record
```

## Key Files
- `infra/dev/docker-compose.yml`   — full dev stack
- `infra/dev/litellm.yaml`         — AI model routing config
- `infra/dev/.env.example`         — all environment variables documented
- `packages/db/prisma/schema.prisma` — database schema (source of truth)
- `packages/shared/src/schemas/`   — all Zod schemas
- `CLAUDE.md`                      — this file

## Connector Build Order
Phase 0 (now): Core + Okta/JumpCloud + Google Workspace + Slack + GitHub + JSM
Phase 1:       Microsoft Entra ID + Graph API + Intune
Phase 2:       Salesforce + Azure Sentinel
Phase 3:       SAP SuccessFactors + SAP CIS  ← only when SAP customer signs

## Decisions Made
[ Add every architectural decision here immediately ]
- Multi-tenant RLS: current_setting('app.tenant_id') in PostgreSQL
- AI routing: x-data-sensitivity:high header forces local model
- Leaver order: Okta/Entra FIRST (instant SSO block), then cascade
- Audit log: append-only enforced via PG trigger, HMAC-SHA256 on every row
- Secrets: process.env only, validated at startup with Zod env schema
- JSM: bidirectional — triggers JML events AND receives auto-created tickets
- SCIM fallback: if SCIM fails, fall back to REST API per connector
- Ollama runs on HOST (not in Docker) — http://host.docker.internal:11434
