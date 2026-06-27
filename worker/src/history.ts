import type { MessageEnvelope } from "./schemas.js";

const HISTORY_PREFIX = "history:";
const MAX_HISTORY_PER_ROOM = 200;

export async function persistMessage(
  kv: KVNamespace,
  message: MessageEnvelope
): Promise<void> {
  const key = `${HISTORY_PREFIX}${message.roomId}`;
  const existing = await kv.get(key);
  const messages: MessageEnvelope[] = existing ? JSON.parse(existing) : [];

  messages.push(message);

  // Trim to max window — keep newest
  const trimmed = messages.slice(-MAX_HISTORY_PER_ROOM);

  // KV TTL: 7 days
  await kv.put(key, JSON.stringify(trimmed), { expirationTtl: 7 * 24 * 60 * 60 });
}

export async function getHistory(
  kv: KVNamespace,
  roomId: string,
  since: number
): Promise<MessageEnvelope[]> {
  const key = `${HISTORY_PREFIX}${roomId}`;
  const raw = await kv.get(key);
  if (!raw) return [];

  const messages: MessageEnvelope[] = JSON.parse(raw);
  return messages.filter((m) => m.timestamp > since);
}
