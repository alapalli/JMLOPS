-- ─────────────────────────────────────────────────────────────
-- JML Ops · PostgreSQL 16 init script
-- Runs once on first container start
-- ─────────────────────────────────────────────────────────────

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- fast text search

-- TimescaleDB (optional — comment out if not using)
-- CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- ── App config function (used by RLS) ───────────────────────
CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS TEXT AS $$
  SELECT current_setting('app.tenant_id', true)
$$ LANGUAGE sql STABLE;

-- Create app schema if Prisma uses public
-- (we keep everything in public for simplicity)

-- ── Audit log immutability trigger ──────────────────────────
-- Prevent any UPDATE or DELETE on audit_log
CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log rows are immutable. Attempted % on row id=%',
    TG_OP, OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger is attached AFTER Prisma creates the table (see schema.prisma)
-- Run this in a migration: see packages/db/prisma/migrations/

-- ── HMAC verify function ────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_audit_hmac(
  payload TEXT,
  stored_hmac TEXT,
  secret TEXT
) RETURNS BOOLEAN AS $$
  SELECT stored_hmac = encode(
    hmac(payload::bytea, secret::bytea, 'sha256'),
    'hex'
  );
$$ LANGUAGE sql IMMUTABLE;

-- ── Useful indexes (created after Prisma migrations) ────────
-- These are created here as a reminder; Prisma schema also defines them

-- ── Default search path ─────────────────────────────────────
ALTER DATABASE jmlops SET search_path TO public;
