import React, { useEffect, useRef, useCallback } from "react";
import { MessageBubble } from "./MessageBubble.js";
import { MessageInput } from "./MessageInput.js";
import { PresenceBar } from "./PresenceBar.js";
import { ConsolePanel } from "./ConsolePanel.js";
import { useWSClient } from "../ws/useWSClient.js";
import { useChatStore } from "../store/chatStore.js";
import type {
  ConnectionOpenPayload,
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

  // Keep stable store actions without re-subscribing every render
  const {
    setReceiver,
    receiveMessage,
    updateMessageStatus,
    userJoin,
    userLeave,
    syncHistory,
    syncPresence,
    addOptimisticMessage,
    receiverId,
    messages,
    presenceMap,
  } = store;

  useEffect(() => {
    if (initialReceiverId) {
      setReceiver(initialReceiverId);
    }
  }, [initialReceiverId, setReceiver]);

  useEffect(() => {
    const unsubOpen = on<ConnectionOpenPayload>("connection.open", (frame) => {
      setCurrentSessionId(frame.payload.sessionId);
      if (frame.payload.presence?.length) {
        syncPresence(frame.payload.presence);
      }
    });

    const unsubReceive = on<MessageEnvelope>("message.receive", (frame) => {
      receiveMessage(frame.payload);
    });

    const unsubStatus = on<MessageStatusUpdatePayload>("message.status_update", (frame) => {
      updateMessageStatus(
        frame.payload.messageId,
        frame.payload.status,
        frame.payload.optimisticId
      );
    });

    const unsubJoin = on<UserPresencePayload>("user.join", (frame) => {
      userJoin(frame.payload.sessionId, frame.payload.userId, frame.payload.displayName);
    });

    const unsubLeave = on<UserPresencePayload>("user.leave", (frame) => {
      userLeave(frame.payload.sessionId);
    });

    const unsubSync = on<RoomSyncResponsePayload>("room.sync_response", (frame) => {
      syncHistory(frame.payload.messages);
    });

    return () => {
      unsubOpen();
      unsubReceive();
      unsubStatus();
      unsubJoin();
      unsubLeave();
      unsubSync();
    };
  }, [
    on,
    receiveMessage,
    updateMessageStatus,
    userJoin,
    userLeave,
    syncHistory,
    syncPresence,
  ]);

  useEffect(() => {
    if (!connected) return;
    send({
      type: "room.sync_request",
      frameId: crypto.randomUUID(),
      roomId,
      payload: { since: Date.now() - 60 * 60 * 1000 },
    });
  }, [connected, send, roomId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    (body: string) => {
      const optimisticId = crypto.randomUUID();
      const now = Date.now();

      if (!receiverId) {
        alert("No receiver selected!");
        return;
      }

      const optimistic: MessageEnvelope = {
        messageId: optimisticId,
        senderId: userId,
        receiverId,
        roomId,
        timestamp: now,
        payload: { type: "text", body },
        status: "sending",
        metadata: {
          clientTimestamp: now,
          sessionId: "",
          optimisticId,
          version: 1,
        },
      };
      addOptimisticMessage(optimistic);

      send<MessageSendPayload>({
        type: "message.send",
        frameId: optimisticId,
        roomId,
        payload: { receiverId, body, clientTimestamp: now },
      });
    },
    [send, addOptimisticMessage, userId, receiverId, roomId]
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #ddd" }}>
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #ddd",
            backgroundColor: "#f8f8f8",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
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
          <span style={{ color: "#888", fontSize: "13px" }}>
            {displayName} ({userId || "Unknown"})
          </span>
          <span style={{ color: "#0b93f6", fontSize: "13px", fontWeight: 500 }}>
            Chatting with: {receiverId || initialReceiverId || "None"}
          </span>
          <span style={{ color: "#888", fontSize: "13px" }}>
            {connected ? "Connected" : "Reconnecting…"}
          </span>
        </div>

        <PresenceBar presenceMap={presenceMap} currentSessionId={currentSessionId} />

        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            backgroundColor: "#fff",
          }}
        >
          {messages.map((msg) => (
            <MessageBubble
              key={msg.messageId}
              message={msg}
              isSelf={msg.senderId === userId}
              onReply={(id) => setReceiver(id)}
            />
          ))}
        </div>

        <MessageInput onSend={handleSend} disabled={!connected} />
      </div>

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
