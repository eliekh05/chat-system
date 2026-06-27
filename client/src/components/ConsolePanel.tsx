import React, { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ConsoleCommandPayload, WSFrame } from "../types.js";

interface Props {
  onCommand: (command: string, args: string[]) => void;
  onFrame: (handler: (frame: WSFrame<unknown>) => void) => () => void;
  roomId: string;
}

export const ConsolePanel: React.FC<Props> = ({ onCommand, onFrame, roomId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef<string>("");

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize xterm.js terminal
    const term = new Terminal({
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
      },
      fontFamily: '"Cascadia Code", "Fira Code", monospace',
      fontSize: 13,
      scrollback: 1000,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln("\x1b[36m╔════════════════════════════════╗\x1b[0m");
    term.writeln("\x1b[36m║   Chat System Dev Console      ║\x1b[0m");
    term.writeln("\x1b[36m╚════════════════════════════════╝\x1b[0m");
    term.writeln(`\x1b[90mRoom: ${roomId}\x1b[0m`);
    term.writeln(`\x1b[90mType 'status' or 'ping' for commands\x1b[0m`);
    term.writeln("");
    term.write("\x1b[32m> \x1b[0m");

    // Handle keyboard input for CLI
    term.onKey(({ key, domEvent }) => {
      const printable =
        !domEvent.altKey && !domEvent.ctrlKey && !domEvent.metaKey;

      if (domEvent.key === "Enter") {
        term.writeln("");
        const input = inputBufferRef.current.trim();
        inputBufferRef.current = "";
        if (input.length > 0) {
          const parts = input.split(/\s+/);
          const command = parts[0];
          const args = parts.slice(1);
          onCommand(command, args);
        }
        term.write("\x1b[32m> \x1b[0m");
      } else if (domEvent.key === "Backspace") {
        if (inputBufferRef.current.length > 0) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          term.write("\b \b");
        }
      } else if (printable) {
        inputBufferRef.current += key;
        term.write(key);
      }
    });

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [roomId]);

  // Subscribe to console frames
  useEffect(() => {
    const unsub = onFrame((frame) => {
      if (frame.type === "console.event" && termRef.current) {
        const payload = frame.payload as { ansiFormatted: string };
        termRef.current.writeln(payload.ansiFormatted);
        // Re-render input prompt after log line
        termRef.current.write("\x1b[32m> \x1b[0m" + inputBufferRef.current);
      }
    });
    return unsub;
  }, [onFrame]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#1e1e1e",
        borderRadius: "4px",
        overflow: "hidden",
      }}
    />
  );
};
