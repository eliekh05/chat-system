import React, { useEffect, useRef, useCallback } from "react";
import { MessageBubble } from "./MessageBubble.js";
import { MessageInput } from "./MessageInput.js";
import { PresenceBar } from "./PresenceBar.js";
import { useWSClient } from "../ws/useWSClient.js";
import { useChatStore } from "../store/chatStore.js";
import type {
  ConnectionOpenPayload,
  MessageEnvelope,
  MessageSendPayload,
  MessageStatusUpdatePayload,
  UserPresencePayload,
  RoomSyncResponsePayload,
  ErrorFramePayload,
} from "../types.js";

interface Props {
  workerBaseUrl: string;
  roomId: string;
  sessionToken: string;
  userId: string;
  displayName: string;
  initialReceiverId: string;
  onLogout: () => void;
}

export const ChatView: React.FC<Props> = ({
  workerBaseUrl,
  roomId,
  sessionToken,
  userId,
  displayName,
  initialReceiverId,
  onLogout,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentSessionId, setCurrentSessionId] = React.useState<string>("");
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [nameMap, setNameMap] = React.useState<Map<string, string>>(new Map());
  const store = useChatStore();
  const { connected, send, on } = useWSClient({
    workerBaseUrl,
    roomId,
    sessionToken,
    enabled: true,
  });

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

  // Track names for userId→displayName resolution
  const nameMapRef = useRef(nameMap);
  nameMapRef.current = nameMap;

  // Build name map from presence data
  useEffect(() => {
    const next = new Map(nameMapRef.current);
    for (const [, p] of presenceMap) {
      next.set(p.userId, p.displayName);
    }
    // Always include self
    next.set(userId, displayName);
    setNameMap(next);
  }, [presenceMap, userId, displayName]);

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

    const unsubError = on<ErrorFramePayload>("error.frame", (frame) => {
      setServerError(frame.payload.message);
      setTimeout(() => setServerError(null), 5000);
    });

    return () => {
      unsubOpen();
      unsubReceive();
      unsubStatus();
      unsubJoin();
      unsubLeave();
      unsubSync();
      unsubError();
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

  // Filter messages: only show messages between self and receiver
  const filteredMessages = React.useMemo(() => {
    if (!receiverId) return messages;
    return messages.filter(
      (m) =>
        (m.senderId === userId && m.receiverId === receiverId) ||
        (m.senderId === receiverId && m.receiverId === userId)
    );
  }, [messages, userId, receiverId]);

  const resolveName = useCallback(
    (id: string) => nameMapRef.current.get(id) || id.substring(0, 8),
    []
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
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
            Chatting with: {resolveName(receiverId || initialReceiverId)}
          </span>
          <span style={{ color: "#888", fontSize: "13px" }}>
            {connected ? "Connected" : "Reconnecting…"}
          </span>
          <button
            onClick={onLogout}
            style={{
              marginLeft: "auto",
              padding: "4px 12px",
              fontSize: "12px",
              border: "1px solid #ddd",
              borderRadius: "6px",
              backgroundColor: "#fff",
              cursor: "pointer",
              color: "#666",
            }}
          >
            Logout
          </button>
        </div>

        {serverError && (
          <div
            style={{
              padding: "8px 16px",
              backgroundColor: "#ffebee",
              borderBottom: "1px solid #f44336",
              color: "#c62828",
              fontSize: "13px",
            }}
          >
            Server: {serverError}
          </div>
        )}

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
          {filteredMessages.map((msg) => (
            <MessageBubble
              key={msg.messageId}
              message={msg}
              isSelf={msg.senderId === userId}
              senderDisplayName={resolveName(msg.senderId)}
              onReply={(id) => setReceiver(id)}
            />
          ))}
        </div>

        <MessageInput onSend={handleSend} disabled={!connected} />
      </div>
    </div>
  );
};
