import React, { useState, useCallback, type KeyboardEvent } from "react";

interface Props {
  onSend: (body: string) => void;
  disabled?: boolean;
}

export const MessageInput: React.FC<Props> = ({ onSend, disabled }) => {
  const [value, setValue] = useState("");

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }, [value, onSend, disabled]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        padding: "12px",
        borderTop: "1px solid #ddd",
        backgroundColor: "#fff",
      }}
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={disabled ? "Connecting…" : "Type a message…"}
        rows={1}
        style={{
          flex: 1,
          resize: "none",
          padding: "8px 12px",
          borderRadius: "20px",
          border: "1px solid #ddd",
          fontSize: "15px",
          outline: "none",
          fontFamily: "inherit",
        }}
      />
      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        style={{
          padding: "8px 18px",
          borderRadius: "20px",
          border: "none",
          backgroundColor: "#0b93f6",
          color: "#fff",
          fontSize: "15px",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled || !value.trim() ? 0.5 : 1,
        }}
      >
        Send
      </button>
    </div>
  );
};
