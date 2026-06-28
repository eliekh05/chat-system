import type {
  WSFrame,
  MessageEnvelope,
  MessageSendPayload,
  MessageAckPayload,
  ConnectionOpenPayload,
  RoomSyncRequestPayload,
  ConsoleCommandPayload,
  SessionRecord,
} from "./schemas.js";
import { makeErrorFrame, ERROR_CODES } from "./errors.js";
import { makeConsoleFrame } from "./console.js";
import { persistMessage, getHistory } from "./history.js";

interface ConnectedSession {
  ws: WebSocket;
  userId: string;
  displayName: string;
  sessionId: string;
  connectedAt: number;
}

export class RoomDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  // Map from sessionId → ConnectedSession
  private sessions: Map<string, ConnectedSession> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade path
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request, url);
    }

    // Internal HTTP: room history endpoint
    if (url.pathname.endsWith("/history")) {
      const since = Number(url.searchParams.get("since") ?? "0");
      const roomId = url.searchParams.get("roomId") ?? "";
      const messages = await getHistory(this.env.CHAT_KV, roomId, since);
      return new Response(JSON.stringify({ messages }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleWebSocketUpgrade(
    request: Request,
    url: URL
  ): Promise<Response> {
    const sessionToken = url.searchParams.get("token");
    const roomId = url.searchParams.get("roomId");

    if (!sessionToken || !roomId) {
      return new Response("Missing token or roomId", { status: 400 });
    }

    // Validate session via KV
    const sessionRaw = await this.env.CHAT_KV.get(`session:${sessionToken}`);
    if (!sessionRaw) {
      return new Response("Invalid session", { status: 401 });
    }

    const session: SessionRecord = JSON.parse(sessionRaw);
    if (Date.now() > session.expiresAt) {
      return new Response("Session expired", { status: 401 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Accept on the server side
    this.state.acceptWebSocket(server);

    const sessionId = crypto.randomUUID();

    // Store on server WebSocket for retrieval in handlers
    (server as any).__sessionId = sessionId;
    (server as any).__userId = session.userId;
    (server as any).__displayName = session.displayName;
    (server as any).__roomId = roomId;

    // Register session
    this.sessions.set(sessionId, {
      ws: server,
      userId: session.userId,
      displayName: session.displayName,
      sessionId,
      connectedAt: Date.now(),
    });

    // Persist session metadata to DO storage to survive restarts
    await this.state.storage.put(`session:${sessionId}`, {
      userId: session.userId,
      displayName: session.displayName,
      connectedAt: Date.now(),
    });

    // Notify room of join
    await this.broadcastExcept(sessionId, {
      type: "user.join",
      frameId: crypto.randomUUID(),
      roomId,
      timestamp: Date.now(),
      payload: { sessionId, userId: session.userId, displayName: session.displayName },
    });

    // Emit console event
    await this.broadcastConsole(
      roomId,
      "info",
      "room",
      `${session.displayName} connected (${sessionId.substring(0, 8)})`
    );

    // Send connection.open ack to newly connected client
    server.send(
      JSON.stringify({
        type: "connection.open",
        frameId: crypto.randomUUID(),
        roomId,
        timestamp: Date.now(),
        payload: {
          sessionId,
          userId: session.userId,
          displayName: session.displayName,
          protocolVersion: 1,
        },
      })
    );

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // CF Durable Objects WebSocket event handlers
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return; // binary not supported in this protocol

    const sessionId: string = (ws as any).__sessionId;
    const roomId: string = (ws as any).__roomId;
    let session = this.sessions.get(sessionId);

    if (!session) {
      const meta = await this.state.storage.get<any>(`session:${sessionId}`);
      if (meta) {
        session = {
          ws,
          userId: meta.userId,
          displayName: meta.displayName,
          sessionId,
          connectedAt: meta.connectedAt,
        };
        this.sessions.set(sessionId, session);
      } else {
        ws.send(makeErrorFrame(ERROR_CODES.INVALID_SESSION, "Session not registered"));
        return;
      }
    }

    let frame: WSFrame;
    try {
      frame = JSON.parse(message);
    } catch {
      ws.send(makeErrorFrame(ERROR_CODES.MALFORMED_FRAME, "Invalid JSON frame"));
      return;
    }

    switch (frame.type) {
      case "connection.ping":
        ws.send(
          JSON.stringify({
            type: "connection.pong",
            frameId: frame.frameId,
            roomId,
            timestamp: Date.now(),
            payload: {},
          })
        );
        break;

      case "message.send":
        await this.handleMessageSend(frame as WSFrame<MessageSendPayload>, session, roomId);
        break;

      case "message.ack":
        await this.handleMessageAck(frame as WSFrame<MessageAckPayload>, roomId);
        break;

      case "room.sync_request":
        await this.handleSyncRequest(frame as WSFrame<RoomSyncRequestPayload>, ws, roomId);
        break;

      case "console.command":
        await this.handleConsoleCommand(frame as WSFrame<ConsoleCommandPayload>, session, roomId);
        break;

      default:
        ws.send(
          makeErrorFrame(
            ERROR_CODES.MALFORMED_FRAME,
            `Unknown frame type: ${frame.type}`,
            frame.frameId
          )
        );
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const sessionId: string = (ws as any).__sessionId;
    const roomId: string = (ws as any).__roomId;
    const session = this.sessions.get(sessionId);

    if (session) {
      this.sessions.delete(sessionId);
      await this.state.storage.delete(`session:${sessionId}`);

      await this.broadcastExcept(sessionId, {
        type: "user.leave",
        frameId: crypto.randomUUID(),
        roomId,
        timestamp: Date.now(),
        payload: { sessionId, userId: session.userId, displayName: session.displayName },
      });

      await this.broadcastConsole(
        roomId,
        "info",
        "room",
        `${session.displayName} disconnected (code=${code})`
      );
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const sessionId: string = (ws as any).__sessionId;
    const roomId: string = (ws as any).__roomId ?? "unknown";

    await this.broadcastConsole(roomId, "error", "room", `WebSocket error on session ${sessionId}`);
    this.sessions.delete(sessionId);
  }

  private async handleMessageSend(
    frame: WSFrame<MessageSendPayload>,
    senderSession: ConnectedSession,
    roomId: string
  ): Promise<void> {
    const { receiverId, body, clientTimestamp } = frame.payload;

    const envelope: MessageEnvelope = {
      messageId: crypto.randomUUID(),
      senderId: senderSession.userId,
      receiverId,
      roomId,
      timestamp: Date.now(),
      payload: { type: "text", body },
      status: "delivered",
      metadata: {
        clientTimestamp,
        sessionId: senderSession.sessionId,
        optimisticId: frame.frameId,
        version: 1,
      },
    };

    // Send to receiver AND sender if online
    let delivered = false;
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      const sessionId = (ws as any).__sessionId;
      if (!sessionId) continue;

      const meta = await this.state.storage.get<any>(`session:${sessionId}`);
      if (!meta) continue;

      if (meta.userId === receiverId || meta.userId === senderSession.userId) {
        ws.send(
          JSON.stringify({
            type: "message.receive",
            frameId: crypto.randomUUID(),
            roomId,
            timestamp: Date.now(),
            payload: envelope,
          })
        );
        if (meta.userId === receiverId) delivered = true;
      }
    }

    // Update status based on delivery
    envelope.status = delivered ? "delivered" : "sent";

    // Persist to KV (async — do not await to avoid blocking)
    this.env.CHAT_KV && persistMessage(this.env.CHAT_KV, envelope).catch(() => {});

    // Ack back to sender
    senderSession.ws.send(
      JSON.stringify({
        type: "message.status_update",
        frameId: frame.frameId,
        roomId,
        timestamp: Date.now(),
        payload: {
          optimisticId: frame.frameId,
          messageId: envelope.messageId,
          status: envelope.status,
        },
      })
    );

    await this.broadcastConsole(
      roomId,
      "debug",
      "message",
      `msg ${envelope.messageId.substring(0, 8)} → ${receiverId.substring(0, 8)} [${envelope.status}]`
    );
  }

  private async handleMessageAck(
    frame: WSFrame<MessageAckPayload>,
    roomId: string
  ): Promise<void> {
    const { messageId } = frame.payload;

    // Notify sender that message was read — find sender by scanning DO storage
    // (In a production system you'd maintain a messageId→senderId index in DO storage)
    await this.broadcastConsole(roomId, "debug", "ack", `ack received for ${messageId.substring(0, 8)}`);
  }

  private async handleSyncRequest(
    frame: WSFrame<RoomSyncRequestPayload>,
    ws: WebSocket,
    roomId: string
  ): Promise<void> {
    const { since } = frame.payload;
    const messages = await getHistory(this.env.CHAT_KV, roomId, since);

    ws.send(
      JSON.stringify({
        type: "room.sync_response",
        frameId: frame.frameId,
        roomId,
        timestamp: Date.now(),
        payload: { messages },
      })
    );
  }

  private async handleConsoleCommand(
    frame: WSFrame<ConsoleCommandPayload>,
    session: ConnectedSession,
    roomId: string
  ): Promise<void> {
    const { command, args } = frame.payload;

    // Simple CLI dispatcher
    switch (command) {
      case "status": {
        const sockets = this.state.getWebSockets();
        const activeUsers = [];
        for (const ws of sockets) {
          const sid = (ws as any).__sessionId;
          if (sid) {
            const meta = await this.state.storage.get<any>(`session:${sid}`);
            if (meta) {
              activeUsers.push(`  - ${meta.displayName} (${meta.userId.substring(0, 8)})`);
            }
          }
        }

        const lines = [
          `Room: ${roomId}`,
          `Connected sockets: ${sockets.length}`,
          ...activeUsers,
        ];
        session.ws.send(
          JSON.stringify({
            type: "console.event",
            frameId: crypto.randomUUID(),
            roomId,
            timestamp: Date.now(),
            payload: {
              level: "info",
              source: "cli",
              message: lines.join("\n"),
              ansiFormatted: lines.join("\r\n"),
            },
          })
        );
        break;
      }

      case "ping": {
        session.ws.send(
          JSON.stringify({
            type: "console.event",
            frameId: crypto.randomUUID(),
            roomId,
            timestamp: Date.now(),
            payload: {
              level: "info",
              source: "cli",
              message: "pong",
              ansiFormatted: "\x1b[32mpong\x1b[0m",
            },
          })
        );
        break;
      }

      default: {
        session.ws.send(
          JSON.stringify({
            type: "console.event",
            frameId: crypto.randomUUID(),
            roomId,
            timestamp: Date.now(),
            payload: {
              level: "warn",
              source: "cli",
              message: `Unknown command: ${command}`,
              ansiFormatted: `\x1b[33mUnknown command: ${command}\x1b[0m`,
            },
          })
        );
      }
    }
  }

  private async broadcastExcept(excludeSessionId: string, frame: WSFrame): Promise<void> {
    const serialized = JSON.stringify(frame);
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      const sessionId = (ws as any).__sessionId;
      if (sessionId && sessionId !== excludeSessionId) {
        try {
          ws.send(serialized);
        } catch {
          // WebSocket may be in closing state
        }
      }
    }
  }

  private async broadcastConsole(
    roomId: string,
    level: "info" | "warn" | "error" | "debug",
    source: string,
    message: string
  ): Promise<void> {
    const frame = makeConsoleFrame(roomId, level, source, message);
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(frame);
      } catch {
        // ignore closed sockets
      }
    }
  }
}
