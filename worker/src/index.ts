import { RoomDurableObject } from "./room.js";
import type { Env } from "./room.js";
import { createSession, validateSession } from "./session.js";
import { getHistory } from "./history.js";

export { RoomDurableObject };
export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for all responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Route: POST /api/session/create ──────────────────────────────────────
    if (path === "/api/session/create" && request.method === "POST") {
      let body: { displayName?: string; userId?: string };
      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid JSON body" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!body.displayName || typeof body.displayName !== "string") {
        return new Response(
          JSON.stringify({ error: "displayName is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const session = await createSession(
        env.CHAT_KV,
        body.displayName.trim().substring(0, 32),
        typeof body.userId === "string" ? body.userId.trim() || undefined : undefined
      );
      return new Response(JSON.stringify(session), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Route: GET /api/room/:roomId/history ─────────────────────────────────
    const historyMatch = path.match(/^\/api\/room\/([^/]+)\/history$/);
    if (historyMatch && request.method === "GET") {
      const roomId = historyMatch[1];
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");

      if (!token) {
        return new Response(
          JSON.stringify({ error: "Authorization required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const session = await validateSession(env.CHAT_KV, token);
      if (!session) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const since = Number(url.searchParams.get("since") ?? "0");
      const messages = await getHistory(env.CHAT_KV, roomId, since);
      return new Response(JSON.stringify({ messages }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Route: GET /ws/:roomId — WebSocket upgrade ───────────────────────────
    const wsMatch = path.match(/^\/ws\/([^/]+)$/);
    if (wsMatch) {
      const roomId = wsMatch[1];
      const upgradeHeader = request.headers.get("Upgrade");

      if (upgradeHeader !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      const token = url.searchParams.get("token");
      if (!token) {
        return new Response("Missing token query parameter", { status: 400 });
      }

      // Derive Durable Object ID deterministically from roomId
      // This ensures all clients connecting to the same room hit the same DO instance
      const doId = env.ROOM.idFromName(roomId);
      const stub = env.ROOM.get(doId);

      // Forward the entire request to the DO, appending roomId as query param
      const doUrl = new URL(request.url);
      doUrl.searchParams.set("roomId", roomId);

      return stub.fetch(new Request(doUrl.toString(), request));
    }

    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  },
};
