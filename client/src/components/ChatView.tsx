import React, { useEffect, useRef, useCallback } from "react";
import { MessageBubble } from "./MessageBubble.js";
import { MessageInput } from "./MessageInput.js";
import { PresenceBar } from "./PresenceBar.js";
import { ConsolePanel } from "./ConsolePanel.js";
import { useWSClient } from "../ws/useWSClient.js";
import { useChatStore } from "../store/chatStore.js";
import type {
  MessageEnvelope,
  MessageSendPayload,
  MessageStatusUpdatePayload,
  UserPresencePayload,
  RoomSyncResponsePayload,
  ConsoleCommandPayload,
  WSFrame,
} from "../types.js";

interface Props {
  workerBaseUrl: string;
  roomId: string;
  sessionToken: string;
  userId: string;
  displayName: string;
  initialReceiverId: string;
}

export const ChatView: React.FC<Props> = ({
  workerBaseUrl,
  roomId,
  sessionToken,
  userId,
  displayName,
  initialReceiverId,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentSessionId, setCurrentSessionId] = React.useState<string>("");
  const store = useChatStore();
  const { connected, send, on } = useWSClient({
    workerBaseUrl,
    roomId,
    sessionToken,
    enabled: true,
  });

  // Initialize receiver
  useEffect(() => {
    if (initialReceiverId) {
      store.setReceiver(initialReceiverId);
    }
  }, [initialReceiverId, store]);

  // Subscribe to incoming events
  useEffect(() => {
    const unsubOpen = on<ConnectionOpenPayload>("connection.open", (frame) => {
      setCurrentSessionId(frame.payload.sessionId);
    });

    const unsubReceive = on<MessageEnvelope>("message.receive", (frame) => {
      store.receiveMessage(frame.payload);
    });

    const unsubStatus = on<MessageStatusUpdatePayload>("message.status_update", (frame) => {
      store.updateMessageStatus(frame.payload.messageId, frame.payload.status);
    });

    const unsubJoin = on<UserPresencePayload>("user.join", (frame) => {
      store.userJoin(frame.payload.sessionId, frame.payload.userId, frame.payload.displayName);
    });

    const unsubLeave = on<UserPresencePayload>("user.leave", (frame) => {
      store.userLeave(frame.payload.sessionId);
    });

    const unsubSync = on<RoomSyncResponsePayload>("room.sync_response", (frame) => {
      store.syncHistory(frame.payload.messages);
    });

    return () => {
      unsubOpen();
      unsubReceive();
      unsubStatus();
      unsubJoin();
      unsubLeave();
      unsubSync();
    };
  }, [on, store]);

  // Request sync when connected
  useEffect(() => {
    if (!connected) return;
    send({
      type: "room.sync_request",
      frameId: crypto.randomUUID(),
      roomId,
      payload: { since: Date.now() - 60 * 60 * 1000 }, // Last hour
    });
  }, [connected, send, roomId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [store.messages]);

  const handleSend = useCallback(
    (body: string) => {
      const optimisticId = crypto.randomUUID();
      const now = Date.now();
      const receiverId = store.receiverId;

      if (!receiverId) {
        alert("No receiver selected!");
        return;
      }

      // Optimistic message for instant UI feedback
      const optimistic: MessageEnvelope = {
        messageId: optimisticId,
        senderId: userId,
        receiverId,
        roomId,
        timestamp: now,
        payload: { type: "text", body },
        status: "sending",
        metadata: { clientTimestamp: now, sessionId: "", optimisticId: optimisticId, version: 1 },
      };
      store.addOptimisticMessage(optimistic);

      send<MessageSendPayload>({
        type: "message.send",
        frameId: optimisticId,
        roomId,
        payload: { receiverId, body, clientTimestamp: now },
      });
    },
    [send, store, userId, roomId]
  );

  const handleConsoleCommand = useCallback(
    (command: string, args: string[]) => {
      send<ConsoleCommandPayload>({
        type: "console.command",
        frameId: crypto.randomUUID(),
        roomId,
        payload: { command, args },
      });
    },
    [send, roomId]
  );

  const handleConsoleFrame = useCallback(
    (handler: (frame: WSFrame<unknown>) => void): (() => void) => {
      return on("console.event", handler);
    },
    [on]
  );

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
      {/* Chat panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #ddd" }}>
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #ddd",
            backgroundColor: "#f8f8f8",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              backgroundColor: connected ? "#4caf50" : "#f44336",
            }}
          />
          <span style={{ fontWeight: 600 }}>Room: {roomId}</span>
          <span style={{ color: "#888", fontSize: "13px", marginLeft: "12px" }}>
            My ID: {userId}
          </span>
          <span style={{ color: "#0b93f6", fontSize: "13px", marginLeft: "12px", fontWeight: 500 }}>
            Chatting with: {store.receiverId || "None"}
          </span>
          <span style={{ color: "#888", fontSize: "13px", marginLeft: "12px" }}>
            {connected ? "Connected" : "Reconnecting…"}
          </span>
        </div>

        <PresenceBar presenceMap={store.presenceMap} currentSessionId={currentSessionId} />

        {/* Message thread */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            backgroundColor: "#fff",
          }}
        >
          {store.messages.map((msg) => (
            <MessageBubble
              key={msg.messageId}
              message={msg}
              isSelf={msg.senderId === userId}
              onReply={(id) => store.setReceiver(id)}
            />
          ))}
        </div>

        <MessageInput onSend={handleSend} disabled={!connected} />
      </div>

      {/* xterm.js console panel */}
      <div style={{ width: "420px", display: "flex", flexDirection: "column" }}>
        <div
          style={{
            padding: "8px 12px",
            backgroundColor: "#1e1e1e",
            color: "#888",
            fontSize: "12px",
            borderBottom: "1px solid #333",
          }}
        >
          Developer Console
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ConsolePanel
            onCommand={handleConsoleCommand}
            onFrame={handleConsoleFrame}
            roomId={roomId}
          />
        </div>
      </div>
    </div>
  );
};
