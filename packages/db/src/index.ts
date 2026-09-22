// ─────────────────────────────────────────────────────────────
// @jml-ops/db — Prisma Client Singleton
//
// CLAUDE.md hard rule #1: all DB queries via Prisma, no raw SQL
// except in migrations. This file is the ONLY place PrismaClient
// is instantiated — every app imports { prisma } from here.
// ─────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
