// ─────────────────────────────────────────────────────────────
// @jml-ops/db — Seed Script
//
// With real SSO login now in place (see apps/api/src/auth.ts),
// companies and users are created automatically on first login —
// the first person from a new email domain to sign in becomes
// that company's admin. This script no longer pre-creates a fake
// demo company/user; instead it activates the Entra connector for
// a company that ALREADY EXISTS (created via real login) once you
// provide its domain and Entra credentials.
//
// Typical flow:
//   1. pnpm dev
//   2. Sign in via http://localhost:3000/login (Google or Microsoft)
//      -> this creates your company + admin user automatically
//   3. Set SEED_COMPANY_DOMAIN in .env to match the email domain
//      you just signed in with, plus ENTRA_TENANT_ID/CLIENT_ID/
//      CLIENT_SECRET
//   4. pnpm db:seed   -> activates the Entra connector for that company
//
// Run with: pnpm --filter @jml-ops/db seed
// ─────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding JML Ops connector configuration...");

  const domain = process.env.SEED_COMPANY_DOMAIN;
  if (!domain) {
    console.warn(
      "⚠ SEED_COMPANY_DOMAIN not set in .env — nothing to seed yet.\n" +
      "  Sign in once via SSO first (this creates your company automatically),\n" +
      "  then set SEED_COMPANY_DOMAIN to that email's domain and re-run this script."
    );
    return;
  }

  const company = await prisma.company.findUnique({ where: { domain } });
  if (!company) {
    console.warn(
      `⚠ No company found with domain "${domain}". Sign in via SSO with an email\n` +
      `  at that domain first — companies are created automatically on first login,\n` +
      `  not by this script.`
    );
    return;
  }
  console.log(`✓ Found company: ${company.name} (${company.id})`);

  // ── Entra connector ──────────────────────────────────────────
  //
  // Credentials come from environment variables, never committed.
  // Set these in your .env before running seed:
  //   ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET
  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    console.warn(
      "⚠ ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET not set — " +
      "creating connector record as UNCONFIGURED. Set these in .env and re-run seed " +
      "to activate the real connector."
    );
  }

  const connectorConfig =
    tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : null;

  const connector = await prisma.connector.upsert({
    where: { companyId_type: { companyId: company.id, type: "ENTRA_ID" } },
    update: {
      status: connectorConfig ? "ACTIVE" : "UNCONFIGURED",
      ...(connectorConfig ? { config: connectorConfig } : {}),
    },
    create: {
      companyId: company.id,
      type: "ENTRA_ID",
      name: `${company.name} — Entra ID`,
      status: connectorConfig ? "ACTIVE" : "UNCONFIGURED",
      ...(connectorConfig ? { config: connectorConfig } : {}),
      isEnabled: true,
    },
  });
  console.log(`✓ Entra connector: ${connector.status}`);

  // A default role template so JOINER flows have somewhere to pull
  // group mappings from. v0.1: no group IDs pre-filled — add your
  // real Entra security group object IDs here once you have them.
  const template = await prisma.roleTemplate.upsert({
    where: { companyId_name: { companyId: company.id, name: "Default Employee" } },
    update: {},
    create: {
      companyId: company.id,
      name: "Default Employee",
      isDefault: true,
      connectorMap: {
        ENTRA_ID: { groups: [] }, // fill with real group object IDs
      },
    },
  });
  console.log(`✓ Role template: ${template.name}`);

  console.log("\nSeed complete.");
  console.log(
    connector.status === "ACTIVE"
      ? "Entra connector is ACTIVE — real API calls will be made."
      : "Entra connector is UNCONFIGURED — set env vars and re-run seed to activate."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
