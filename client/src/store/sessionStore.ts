import { useState, useCallback } from "react";
import type { SessionRecord } from "../types.js";

const STORAGE_KEY = "chat_session";

export function useSessionStore() {
  const [session, setSession] = useState<SessionRecord | null>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const s: SessionRecord = JSON.parse(raw);
      if (Date.now() > s.expiresAt) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return s;
    } catch {
      return null;
    }
  });

  const createSession = useCallback(async (
    workerBaseUrl: string,
    displayName: string,
    userId?: string
  ): Promise<SessionRecord> => {
    const res = await fetch(`${workerBaseUrl}/api/session/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, userId }),
    });

    if (!res.ok) {
      throw new Error(`Session creation failed: ${res.status}`);
    }

    const record: SessionRecord = await res.json();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    setSession(record);
    return record;
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  return { session, createSession, clearSession };
}
