import type { ConnectionOpenPayload, WSFrame, WSFrameType } from "../types.js";

type FrameHandler<T = unknown> = (frame: WSFrame<T>) => void;

interface WSClientConfig {
  workerBaseUrl: string;
  roomId: string;
  sessionToken: string;
  onConnected?: () => void;
  onDisconnected?: (code: number, reason: string) => void;
  onError?: (error: Event) => void;
}

const PING_INTERVAL_MS = 20_000;
const RECONNECT_INITIAL_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 10;

export class WSClient {
  private ws: WebSocket | null = null;
  private config: WSClientConfig;
  private handlers: Map<WSFrameType, Set<FrameHandler>> = new Map();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private isIntentionallyClosed = false;
  private frameQueue: string[] = []; // queued frames while reconnecting
  private lastOpenPayload: ConnectionOpenPayload | null = null;

  constructor(config: WSClientConfig) {
    this.config = config;
  }

  connect(): void {
    this.isIntentionallyClosed = false;
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.clearTimers();
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CLOSING) {
      this.ws.close(1000, "Client disconnect");
    }
    this.ws = null;
  }

  send<T>(frame: Omit<WSFrame<T>, "timestamp">): void {
    const serialized = JSON.stringify({ ...frame, timestamp: Date.now() });

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(serialized);
    } else {
      this.frameQueue.push(serialized);
    }
  }

  on<T = unknown>(type: WSFrameType, handler: FrameHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as FrameHandler);

    // If the handler is for connection.open and we already have the payload, fire it immediately
    if (type === "connection.open" && this.lastOpenPayload) {
      (handler as FrameHandler<ConnectionOpenPayload>)({
        type: "connection.open",
        frameId: "cached",
        roomId: this.config.roomId,
        timestamp: Date.now(),
        payload: this.lastOpenPayload,
      });
    }

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler as FrameHandler);
    };
  }

  private openSocket(): void {
    const { workerBaseUrl, roomId, sessionToken } = this.config;

    // Convert HTTP URL to WS URL
    const wsBase = workerBaseUrl.replace(/^http/, "ws");
    const url = `${wsBase}/ws/${encodeURIComponent(roomId)}?token=${encodeURIComponent(sessionToken)}`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startPingLoop();
      this.flushQueue();
      this.config.onConnected?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      this.handleIncoming(event.data);
    };

    ws.onclose = (event: CloseEvent) => {
      this.clearTimers();
      this.config.onDisconnected?.(event.code, event.reason);

      if (!this.isIntentionallyClosed) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = (event: Event) => {
      this.config.onError?.(event);
    };
  }

  private handleIncoming(raw: string): void {
    let frame: WSFrame;
    try {
      frame = JSON.parse(raw);
    } catch {
      console.error("[WSClient] Received malformed frame:", raw);
      return;
    }

    if (frame.type === "connection.open") {
      this.lastOpenPayload = frame.payload as ConnectionOpenPayload;
    }

    const handlers = this.handlers.get(frame.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(frame);
        } catch (err) {
          console.error(`[WSClient] Handler error for ${frame.type}:`, err);
        }
      }
    }
  }

  private startPingLoop(): void {
    this.pingTimer = setInterval(() => {
      this.send({
        type: "connection.ping",
        frameId: crypto.randomUUID(),
        roomId: this.config.roomId,
        payload: {},
      });
    }, PING_INTERVAL_MS);
  }

  private flushQueue(): void {
    while (this.frameQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const frame = this.frameQueue.shift()!;
      this.ws.send(frame);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      console.error("[WSClient] Max reconnect attempts reached");
      this.frameQueue = [];
      return;
    }

    const delay = Math.min(
      RECONNECT_INITIAL_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY_MS
    );

    this.reconnectAttempts++;
    console.log(`[WSClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.openSocket();
    }, delay);
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
