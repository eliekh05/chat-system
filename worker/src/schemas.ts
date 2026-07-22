// ============================================================
// CANONICAL SCHEMAS — shared between Worker and Client
// ============================================================

export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export interface MessagePayload {
  type: "text" | "system" | "console";
  body: string;
}

export interface MessageMetadata {
  clientTimestamp: number;
  sessionId: string;
  optimisticId: string;
  version: number;
}

export interface MessageEnvelope {
  messageId: string;
  senderId: string;
  receiverId: string;
  roomId: string;
  timestamp: number;
  payload: MessagePayload;
  status: MessageStatus;
  metadata: MessageMetadata;
}

export type WSFrameType =
  | "connection.open"
  | "connection.close"
  | "connection.ping"
  | "connection.pong"
  | "message.send"
  | "message.receive"
  | "message.ack"
  | "message.status_update"
  | "user.join"
  | "user.leave"
  | "room.sync_request"
  | "room.sync_response"
  | "console.event"
  | "console.command"
  | "error.frame";

export interface WSFrame<T = unknown> {
  type: WSFrameType;
  frameId: string;
  roomId: string;
  timestamp: number;
  payload: T;
}

export interface UserPresencePayload {
  sessionId: string;
  userId: string;
  displayName: string;
}

export interface ConnectionOpenPayload {
  sessionId: string;
  userId: string;
  displayName: string;
  protocolVersion: number;
  /** Users already present in the room when this connection opened. */
  presence?: UserPresencePayload[];
}

export interface MessageSendPayload {
  receiverId: string;
  body: string;
  clientTimestamp: number;
}

export interface MessageAckPayload {
  messageId: string;
  receivedAt: number;
}

export interface MessageStatusUpdatePayload {
  optimisticId: string;
  messageId: string;
  status: MessageStatus;
}

export interface RoomSyncRequestPayload {
  since: number;
}

export interface RoomSyncResponsePayload {
  messages: MessageEnvelope[];
}

export interface ConsoleEventPayload {
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
  ansiFormatted: string;
}

export interface ConsoleCommandPayload {
  command: string;
  args: string[];
}

export interface ErrorFramePayload {
  code: number;
  message: string;
  frameId?: string;
}

export interface SessionRecord {
  userId: string;
  sessionToken: string;
  displayName: string;
  createdAt: number;
  expiresAt: number;
}
