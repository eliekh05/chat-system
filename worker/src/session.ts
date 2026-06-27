import type { SessionRecord } from "./schemas.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const KV_SESSION_PREFIX = "session:";
const KV_USER_PREFIX = "user:";

export async function createSession(
  kv: KVNamespace,
  displayName: string,
  userId?: string
): Promise<SessionRecord> {
  const finalUserId = userId || crypto.randomUUID();
  const sessionToken = crypto.randomUUID();
  const now = Date.now();

  const record: SessionRecord = {
    userId: finalUserId,
    sessionToken,
    displayName,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };


  // Store by token (for lookup during WS auth)
  await kv.put(
    `${KV_SESSION_PREFIX}${sessionToken}`,
    JSON.stringify(record),
    { expirationTtl: SESSION_TTL_MS / 1000 }
  );

  // Store user profile by userId
  await kv.put(
    `${KV_USER_PREFIX}${finalUserId}`,
    JSON.stringify({ userId: finalUserId, displayName }),
    { expirationTtl: SESSION_TTL_MS / 1000 }
  );


  return record;
}

export async function validateSession(
  kv: KVNamespace,
  sessionToken: string
): Promise<SessionRecord | null> {
  const raw = await kv.get(`${KV_SESSION_PREFIX}${sessionToken}`);
  if (!raw) return null;

  const record: SessionRecord = JSON.parse(raw);
  if (Date.now() > record.expiresAt) {
    await kv.delete(`${KV_SESSION_PREFIX}${sessionToken}`);
    return null;
  }

  return record;
}
