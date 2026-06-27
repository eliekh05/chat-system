import { useEffect, useRef, useState, useCallback } from "react";
import { WSClient } from "./WSClient.js";
import type { WSFrame, WSFrameType } from "../types.js";

interface UseWSClientOptions {
  workerBaseUrl: string;
  roomId: string;
  sessionToken: string;
  enabled: boolean;
}

export function useWSClient(options: UseWSClientOptions) {
  const { workerBaseUrl, roomId, sessionToken, enabled } = options;
  const clientRef = useRef<WSClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled || !sessionToken) return;

    const client = new WSClient({
      workerBaseUrl,
      roomId,
      sessionToken,
      onConnected: () => setConnected(true),
      onDisconnected: () => setConnected(false),
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
      setConnected(false);
    };
  }, [workerBaseUrl, roomId, sessionToken, enabled]);

  const send = useCallback(<T>(frame: Omit<WSFrame<T>, "timestamp">) => {
    clientRef.current?.send(frame);
  }, []);

  const on = useCallback(<T = unknown>(
    type: WSFrameType,
    handler: (frame: WSFrame<T>) => void
  ): (() => void) => {
    if (!clientRef.current) return () => {};
    return clientRef.current.on(type, handler);
  }, []);

  return { connected, send, on, client: clientRef };
}
