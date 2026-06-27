import React from "react";
import type { MessageEnvelope } from "../types.js";

interface Props {
  message: MessageEnvelope;
  isSelf: boolean;
}

const STATUS_SYMBOLS: Record<string, string> = {
  sending: "○",
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
  failed: "✗",
};

export const MessageBubble: React.FC<Props> = ({ message, isSelf }) => {
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isSelf ? "flex-end" : "flex-start",
        marginBottom: "8px",
      }}
    >
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
