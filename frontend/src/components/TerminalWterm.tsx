import { useEffect, useRef } from "react";
import { Terminal as WTermReact, type TerminalHandle as WHandle } from "@wterm/react";
// @ts-expect-error — pacote 0.3.0 não declara o subpath CSS no exports/types
import "@wterm/react/css";

import { Call as $Call } from "@wailsio/runtime";
import { ResizePty, WritePty } from "../../wailsjs/go/main/Terminal";
import { EventsOff, EventsOn } from "../../wailsjs/runtime/runtime";

import type { TerminalHandle } from "./Terminal";

const TERMINAL_WS_PORT_CACHE = { value: 0, fetched: false };
async function getTerminalPort(): Promise<number> {
  if (TERMINAL_WS_PORT_CACHE.fetched) return TERMINAL_WS_PORT_CACHE.value;
  const port = await ($Call.ByName("main.Terminal.GetTerminalPort") as Promise<number>);
  TERMINAL_WS_PORT_CACHE.value = port;
  TERMINAL_WS_PORT_CACHE.fetched = true;
  return port;
}

type Props = {
  sessionId: string;
  active?: boolean;
  onCwd?: (cwd: string) => void;
  onTitle?: (title: string) => void;
  onExit?: (code: number) => void;
  onFileLink?: (path: string, line: number, col: number) => void;
  handleRef?: (handle: TerminalHandle | null) => void;
};

export function TerminalWterm({ sessionId, active = true, onTitle, onExit, handleRef }: Props) {
  const handleRefInternal = useRef<WHandle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const encoder = new TextEncoder();

    const unsubData = EventsOn(`pty:data:${sessionId}`, (b64: string) => {
      const h = handleRefInternal.current;
      if (!h) return;
      try {
        const raw = atob(b64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        h.write(bytes);
      } catch {
        h.write(b64);
      }
    });

    const unsubExit = EventsOn(`pty:exit:${sessionId}`, (code: number) => {
      handleRefInternal.current?.write(
        `\r\n\x1b[90m[processo encerrado · exit ${code}]\x1b[0m\r\n`,
      );
      onExit?.(code);
    });

    void (async () => {
      try {
        const port = await getTerminalPort();
        if (cancelled || !port) return;
        const conn = new WebSocket(`ws://127.0.0.1:${port}/term/${sessionId}`);
        conn.binaryType = "arraybuffer";
        conn.onmessage = (e) => {
          const h = handleRefInternal.current;
          if (!h) return;
          if (e.data instanceof ArrayBuffer) {
            h.write(new Uint8Array(e.data));
          } else if (typeof e.data === "string") {
            h.write(e.data);
          }
        };
        conn.onerror = () => {
          wsRef.current = null;
        };
        conn.onclose = () => {
          wsRef.current = null;
        };
        wsRef.current = conn;
      } catch {
        wsRef.current = null;
      }
    })();

    handleRef?.({
      search: () => {},
      searchNext: () => {},
      searchPrev: () => {},
      clear: () => {
        handleRefInternal.current?.write("\x1b[2J\x1b[H");
      },
      focus: () => handleRefInternal.current?.focus(),
      serialize: () => "",
    });

    return () => {
      cancelled = true;
      unsubData?.();
      unsubExit?.();
      EventsOff(`pty:data:${sessionId}`, `pty:exit:${sessionId}`);
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      handleRef?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (active) handleRefInternal.current?.focus();
  }, [active]);

  // encoder do onData
  const encoderRef = useRef<TextEncoder>(new TextEncoder());

  return (
    <div ref={containerRef} className="h-full w-full">
      <WTermReact
        ref={(h) => {
          handleRefInternal.current = h;
        }}
        autoResize
        cursorBlink
        className="h-full w-full"
        onData={(data) => {
          const conn = wsRef.current;
          if (conn && conn.readyState === WebSocket.OPEN) {
            conn.send(encoderRef.current.encode(data));
          } else {
            WritePty(sessionId, data).catch(() => {});
          }
        }}
        onTitle={(t) => onTitle?.(t)}
        onResize={(cols, rows) => {
          ResizePty(sessionId, cols, rows).catch(() => {});
        }}
      />
    </div>
  );
}

export default TerminalWterm;
