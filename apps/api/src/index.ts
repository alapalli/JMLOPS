import Fastify from "fastify";
import type { Server } from "node:http";
import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import { registerAuth } from "./auth";
import { jmlRoutes } from "./routes/jml";
import { auditRoutes } from "./routes/audit";
import { connectorRoutes } from "./routes/connectors";
import { analyticsRoutes } from "./routes/analytics";
import { employeeRoutes } from "./routes/employees";
import { changeRequestRoutes } from "./routes/requests";
import { assetRoutes } from "./routes/assets";
import { selfServiceRoutes } from "./routes/self-service";
import { registerConnection } from "./websocket";

const PORT = parseInt(process.env.API_PORT ?? "4000", 10);

async function main() {
  const app = Fastify<Server>({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      ...(process.env.NODE_ENV !== "production" ? { transport: { target: "pino-pretty" } } : {}),
    },
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGINS ?? "http://localhost:3000",
    credentials: true,
  });

  await app.register(websocketPlugin);

  await registerAuth(app);

  app.get("/health", async () => ({ status: "ok", service: "jml-ops-api" }));

  await app.register(jmlRoutes);
  await app.register(auditRoutes);
  await app.register(connectorRoutes);
  await app.register(analyticsRoutes);
  await app.register(employeeRoutes);
  await app.register(changeRequestRoutes);
  await app.register(assetRoutes);
  await app.register(selfServiceRoutes);

  // WebSocket endpoint for live job updates. Browsers automatically send
  // the jml_session cookie on the WebSocket upgrade request (same-site,
  // same mechanism as any other fetch) — no token needs to be passed in
  // the URL. We parse it manually here since @fastify/jwt's request.jwtVerify()
  // helper expects a full Fastify request/reply cycle that doesn't quite
  // apply the same way inside a websocket handler.
  //
  // FIX: @fastify/websocket v10 changed its handler signature — the
  // callback now receives the raw WebSocket directly as the first
  // argument, not a `{ socket }` wrapper object like v8/v9 did. The
  // original code was written against the old v8-style API
  // (`connection.socket.close(...)`), which crashed with
  // "Cannot read properties of undefined (reading 'close')" on v10,
  // since `connection.socket` doesn't exist — `connection` IS the socket.
  app.get("/ws", { websocket: true }, (socket, request) => {
    const cookieHeader = request.headers.cookie ?? "";
    const match = cookieHeader.match(/jml_session=([^;]+)/);
    const token = match?.[1];
    if (!token) {
      socket.close(4001, "Missing session cookie");
      return;
    }
    try {
      const decoded = app.jwt.verify<{ companyId: string }>(token);
      registerConnection(decoded.companyId, socket);
    } catch {
      socket.close(4001, "Invalid or expired session");
    }
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`[api] JML Ops API listening on port ${PORT}`);
}

main().catch((err) => {
  console.error("[api] Fatal startup error:", err);
  process.exit(1);
});
