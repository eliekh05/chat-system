const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  info: "\x1b[36m",    // cyan
  warn: "\x1b[33m",    // yellow
  error: "\x1b[31m",   // red
  debug: "\x1b[90m",   // dark gray
  dim: "\x1b[2m",
};

type LogLevel = "info" | "warn" | "error" | "debug";

export function formatConsoleEvent(
  level: LogLevel,
  source: string,
  message: string
): string {
  const ts = new Date().toISOString().substring(11, 23); // HH:MM:SS.mmm
  const color = ANSI[level];
  return (
    `${ANSI.dim}[${ts}]${ANSI.reset} ` +
    `${color}${ANSI.bold}[${level.toUpperCase()}]${ANSI.reset} ` +
    `${ANSI.dim}(${source})${ANSI.reset} ` +
    `${message}`
  );
}

export function makeConsoleFrame(
  roomId: string,
  level: LogLevel,
  source: string,
  message: string
): string {
  return JSON.stringify({
    type: "console.event",
    frameId: crypto.randomUUID(),
    roomId,
    timestamp: Date.now(),
    payload: {
      level,
      source,
      message,
      ansiFormatted: formatConsoleEvent(level, source, message),
    },
  });
}
