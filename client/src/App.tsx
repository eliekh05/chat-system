import React, { useState, useCallback } from "react";
import { ChatView } from "./components/ChatView.js";
import { useSessionStore } from "./store/sessionStore.js";

const WORKER_BASE_URL = import.meta.env.VITE_WORKER_URL as string;
const DEFAULT_ROOM = "general";

export default function App() {
  const { session, createSession } = useSessionStore();
  const [userIdInput, setUserIdInput] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [receiverIdInput, setReceiverIdInput] = useState("");
  const [roomId] = useState(DEFAULT_ROOM);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeReceiverId, setActiveReceiverId] = useState<string | null>(null);

  const handleJoin = useCallback(async () => {
    if (!displayNameInput.trim() || !receiverIdInput.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createSession(
        WORKER_BASE_URL,
        displayNameInput.trim(),
        userIdInput.trim() || undefined
      );
      setActiveReceiverId(receiverIdInput.trim());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
  }, [displayNameInput, receiverIdInput, userIdInput, createSession]);

  if (session?.userId && activeReceiverId) {
    return (
      <ChatView
        workerBaseUrl={WORKER_BASE_URL}
        roomId={roomId}
        sessionToken={session.sessionToken}
        userId={session.userId}
        displayName={session.displayName}
        initialReceiverId={activeReceiverId}
      />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#f5f5f5",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          padding: "32px",
          borderRadius: "12px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
          width: "360px",
        }}
      >
        <h2 style={{ margin: "0 0 24px", fontSize: "22px" }}>Join Chat</h2>
        <input
          type="text"
          placeholder="Your User ID (share this to receive messages)"
          value={userIdInput}
          onChange={(e) => setUserIdInput(e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Your display name"
          value={displayNameInput}
          onChange={(e) => setDisplayNameInput(e.target.value)}
          style={{ ...inputStyle, marginTop: "12px" }}
        />
        <input
          type="text"
          placeholder="Receiver user ID"
          value={receiverIdInput}
          onChange={(e) => setReceiverIdInput(e.target.value)}
          style={{ ...inputStyle, marginTop: "12px" }}
        />
        {error && (
          <p style={{ color: "#f44336", fontSize: "13px", margin: "8px 0 0" }}>{error}</p>
        )}
        <button
          onClick={handleJoin}
          disabled={creating || !displayNameInput.trim() || !receiverIdInput.trim()}
          style={{
            marginTop: "20px",
            width: "100%",
            padding: "12px",
            backgroundColor: "#0b93f6",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontSize: "16px",
            cursor: creating ? "not-allowed" : "pointer",
            opacity: creating ? 0.7 : 1,
          }}
        >
          {creating ? "Connecting…" : "Join"}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #ddd",
  fontSize: "15px",
  boxSizing: "border-box",
  outline: "none",
};
