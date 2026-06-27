export const ERROR_CODES = {
  INVALID_SESSION: 4001,
  SESSION_EXPIRED: 4002,
  ROOM_NOT_FOUND: 4004,
  MALFORMED_FRAME: 4010,
  UNAUTHORIZED: 4030,
  RATE_LIMITED: 4029,
  INTERNAL: 5000,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function makeErrorFrame(
  code: ErrorCode,
  message: string,
  frameId?: string
): string {
  return JSON.stringify({
    type: "error.frame",
    frameId: frameId ?? crypto.randomUUID(),
    roomId: "",
    timestamp: Date.now(),
    payload: { code, message, frameId },
  });
}

