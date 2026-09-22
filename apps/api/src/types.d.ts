// ─────────────────────────────────────────────────────────────
// @jml-ops/api — Ambient Type Declarations
//
// Per @fastify/jwt's own documented TypeScript pattern (see its
// README "TypeScript" section): this file MUST have a top-level
// `import "@fastify/jwt"` for the module augmentation below to
// actually merge into the package's own conditional UserType.
// Earlier attempts at this file omitted the import (assuming a
// pure ambient/global-script file would work) — that assumption
// was wrong for this specific package and silently produced the
// base `string | object | Buffer` type everywhere instead.
// ─────────────────────────────────────────────────────────────

import "@fastify/jwt";

interface JmlJwtPayload {
  userId: string;
  companyId: string;
  role: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JmlJwtPayload; // shape used when signing/verifying
    user: JmlJwtPayload;    // shape returned by request.user after jwtVerify()
  }
}
