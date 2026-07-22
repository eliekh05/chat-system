import type {
  WSFrame,
  MessageEnvelope,
  MessageSendPayload,
  MessageAckPayload,
  RoomSyncRequestPayload,
  ConsoleCommandPayload,
  SessionRecord,
  UserPresencePayload,
} from "./schemas.js";
import { makeErrorFrame, ERROR_CODES } from "./errors.js";
import { makeConsoleFrame } from "./console.js";
import { persistMessage, getHistory } from "./history.js";

export interface Env {
  CHAT_KV: KVNamespace;
  ROOM: DurableObjectNamespace;
}

interface SessionAttachment {
  sessionId: string;
  userId: string;
  displayName: string;
  roomId: string;
  connectedAt: number;
}

interface ConnectedSession {
  ws: WebSocket;
  userId: string;
  displayName: string;
  sessionId: string;
  roomId: string;
  connectedAt: number;
}

function readAttachment(ws: WebSocket): SessionAttachment | null {
  try {
    return (ws.deserializeAttachment() as SessionAttachment | null) ?? null;
  } catch {
    return null;
  }
}

export class RoomDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  /** In-memory map rebuilt after hibernation from WebSocket attachments. */
  private sessions: Map<string, ConnectedSession> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Restore session map after hibernation — custom WS properties are lost.
    for (const ws of this.state.getWebSockets()) {
      const meta = readAttachment(ws);
      if (!meta) continue;
      this.sessions.set(meta.sessionId, {
        ws,
        userId: meta.userId,
        displayName: meta.displayName,
        sessionId: meta.sessionId,
        roomId: meta.roomId,
        connectedAt: meta.connectedAt,
      });
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request, url);
    }

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

    const sessionRaw = await this.env.CHAT_KV.get(`session:${sessionToken}`);
    if (!sessionRaw) {
      return new Response("Invalid session", { status: 401 });
    }

    const session: SessionRecord = JSON.parse(sessionRaw);
    if (Date.now() > session.expiresAt) {
      return new Response("Session expired", { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.state.acceptWebSocket(server);

    const sessionId = crypto.randomUUID();
    const connectedAt = Date.now();
    const attachment: SessionAttachment = {
      sessionId,
      userId: session.userId,
      displayName: session.displayName,
      roomId,
      connectedAt,
    };

    // Survives Durable Object hibernation (unlike custom WS properties).
    server.serializeAttachment(attachment);

    this.sessions.set(sessionId, {
      ws: server,
      userId: session.userId,
      displayName: session.displayName,
      sessionId,
      roomId,
      connectedAt,
    });

    // Presence snapshot for the joiner (everyone already in the room)
    const presence: UserPresencePayload[] = [];
    for (const s of this.sessions.values()) {
      if (s.sessionId === sessionId) continue;
      if (s.roomId !== roomId) continue;
      presence.push({
        sessionId: s.sessionId,
        userId: s.userId,
        displayName: s.displayName,
      });
    }

    this.broadcastExcept(sessionId, {
      type: "user.join",
      frameId: crypto.randomUUID(),
      roomId,
      timestamp: Date.now(),
      payload: {
        sessionId,
        userId: session.userId,
        displayName: session.displayName,
      },
    });

    this.broadcastConsole(
      roomId,
      "info",
      "room",
      `${session.displayName} connected (${sessionId.substring(0, 8)})`
    );

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
          presence,
        },
      })
    );

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private resolveSession(ws: WebSocket): ConnectedSession | null {
    const meta = readAttachment(ws);
    if (!meta) return null;

    let session = this.sessions.get(meta.sessionId);
    if (!session) {
      session = {
        ws,
        userId: meta.userId,
        displayName: meta.displayName,
        sessionId: meta.sessionId,
        roomId: meta.roomId,
        connectedAt: meta.connectedAt,
      };
      this.sessions.set(meta.sessionId, session);
    } else {
      // WS object identity can change after wake — keep map pointed at live socket.
      session.ws = ws;
    }
    return session;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    const session = this.resolveSession(ws);
    if (!session) {
      ws.send(makeErrorFrame(ERROR_CODES.INVALID_SESSION, "Session not registered"));
      return;
    }

    const roomId = session.roomId;

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
        await this.handleConsoleCommand(
          frame as WSFrame<ConsoleCommandPayload>,
          session,
          roomId
        );
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

  async webSocketClose(ws: WebSocket, code: number, _reason: string): Promise<void> {
    const meta = readAttachment(ws);
    if (!meta) return;

    const session = this.sessions.get(meta.sessionId);
    this.sessions.delete(meta.sessionId);

    if (session || meta) {
      const displayName = session?.displayName ?? meta.displayName;
      const roomId = session?.roomId ?? meta.roomId;

      this.broadcastExcept(meta.sessionId, {
        type: "user.leave",
        frameId: crypto.randomUUID(),
        roomId,
        timestamp: Date.now(),
        payload: {
          sessionId: meta.sessionId,
          userId: meta.userId,
          displayName,
        },
      });

      this.broadcastConsole(
        roomId,
        "info",
        "room",
        `${displayName} disconnected (code=${code})`
      );
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    const meta = readAttachment(ws);
    if (meta) {
      this.sessions.delete(meta.sessionId);
      this.broadcastConsole(
        meta.roomId,
        "error",
        "room",
        `WebSocket error on session ${meta.sessionId}`
      );
    }
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

    let delivered = false;

    for (const s of this.sessions.values()) {
      if (s.roomId !== roomId) continue;
      if (s.userId !== receiverId && s.userId !== senderSession.userId) continue;

      try {
        s.ws.send(
          JSON.stringify({
            type: "message.receive",
            frameId: crypto.randomUUID(),
            roomId,
            timestamp: Date.now(),
            payload: envelope,
          })
        );
        if (s.userId === receiverId) delivered = true;
      } catch {
        // closed socket; cleaned up on close
      }
    }

    envelope.status = delivered ? "delivered" : "sent";

    this.env.CHAT_KV && persistMessage(this.env.CHAT_KV, envelope).catch(() => {});

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

    this.broadcastConsole(
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
    this.broadcastConsole(
      roomId,
      "debug",
      "ack",
      `ack received for ${messageId.substring(0, 8)}`
    );
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
    const { command } = frame.payload;

    switch (command) {
      case "status": {
        const activeUsers = Array.from(this.sessions.values())
          .filter((s) => s.roomId === roomId)
          .map(
            (s) =>
              `  - ${s.displayName} (${s.userId.substring(0, 8)}) since ${new Date(s.connectedAt).toISOString()}`
          );

        const lines = [
          `Room: ${roomId}`,
          `Connected sessions: ${activeUsers.length}`,
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

  private broadcastExcept(excludeSessionId: string, frame: WSFrame): void {
    const serialized = JSON.stringify(frame);
    for (const [sid, session] of this.sessions) {
      if (sid === excludeSessionId) continue;
      if (session.roomId !== frame.roomId) continue;
      try {
        session.ws.send(serialized);
      } catch {
        // WebSocket may be closing
      }
    }
  }

  private broadcastConsole(
    roomId: string,
    level: "info" | "warn" | "error" | "debug",
    source: string,
    message: string
  ): void {
    const frame = makeConsoleFrame(roomId, level, source, message);
    for (const session of this.sessions.values()) {
      if (session.roomId !== roomId) continue;
      try {
        session.ws.send(frame);
      } catch {
        // ignore closed sockets
      }
    }
  }
}
