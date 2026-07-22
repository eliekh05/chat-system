import React from "react";
import type { MessageEnvelope } from "../types.js";

interface Props {
  message: MessageEnvelope;
  isSelf: boolean;
  senderDisplayName?: string;
  onReply?: (userId: string) => void;
}

const STATUS_SYMBOLS: Record<string, string> = {
  sending: "○",
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
  failed: "✗",
};

export const MessageBubble: React.FC<Props> = ({ message, isSelf, senderDisplayName, onReply }) => {
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isSelf ? "flex-end" : "flex-start",
        marginBottom: "12px",
      }}
    >
      {!isSelf && (
        <div
          onClick={() => onReply?.(message.senderId)}
          style={{
            fontSize: "11px",
            color: "#888",
            cursor: onReply ? "pointer" : "default",
            marginBottom: "2px",
            userSelect: "none",
          }}
        >
          {senderDisplayName || message.senderId.substring(0, 8)} {onReply ? " (Click to reply)" : ""}
        </div>
      )}
      <div
        style={{
          maxWidth: "65%",
          padding: "8px 12px",
          borderRadius: isSelf ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
          backgroundColor: isSelf ? "#0b93f6" : "#e5e5ea",
          color: isSelf ? "#fff" : "#000",
          wordBreak: "break-word",
        }}
      >
        <div style={{ fontSize: "15px" }}>{message.payload.body}</div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "4px",
            marginTop: "4px",
            fontSize: "11px",
            opacity: 0.7,
          }}
        >
          <span>{time}</span>
          {isSelf && (
            <span
              style={{
                color: message.status === "read" ? "#34b7f1" : "inherit",
              }}
            >
              {STATUS_SYMBOLS[message.status] ?? "○"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
