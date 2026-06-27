import React from "react";

interface Props {
  presenceMap: Map<string, { userId: string; displayName: string }>;
  currentUserId: string;
}

export const PresenceBar: React.FC<Props> = ({ presenceMap, currentUserId }) => {
  const others = Array.from(presenceMap.values()).filter(
    (p) => p.userId !== currentUserId
  );

  return (
    <div
      style={{
        padding: "6px 12px",
        backgroundColor: "#f0f0f0",
        borderBottom: "1px solid #ddd",
        fontSize: "12px",
        color: "#555",
        display: "flex",
        gap: "8px",
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      {others.length === 0 ? (
        <span>No other users online</span>
      ) : (
        <>
          <span>Online:</span>
          {others.map((p) => (
            <span
              key={p.userId}
              style={{
                backgroundColor: "#4caf50",
                color: "#fff",
                padding: "2px 8px",
                borderRadius: "10px",
                fontSize: "11px",
              }}
            >
              {p.displayName}
            </span>
          ))}
        </>
      )}
    </div>
  );
};
