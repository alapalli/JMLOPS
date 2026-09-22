// ─────────────────────────────────────────────────────────────
// @jml-ops/api — WebSocket Broadcast
//
// Simple per-company connection registry. v0.1 keeps this in-memory
// (single API instance assumption) — a multi-instance deployment
// would need this backed by Redis pub/sub instead. Noted as a
// scaling limitation, not addressed in this slice.
// ─────────────────────────────────────────────────────────────

import type { WebSocket } from "@fastify/websocket";
import type { JobUpdateEvent } from "@jml-ops/shared";

const connectionsByCompany = new Map<string, Set<WebSocket>>();

export function registerConnection(companyId: string, socket: WebSocket) {
  if (!connectionsByCompany.has(companyId)) {
    connectionsByCompany.set(companyId, new Set());
  }
  connectionsByCompany.get(companyId)!.add(socket);

  socket.on("close", () => {
    connectionsByCompany.get(companyId)?.delete(socket);
  });
}

export function broadcastJobUpdate(companyId: string, event: JobUpdateEvent) {
  const sockets = connectionsByCompany.get(companyId);
  if (!sockets) return;

  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}
