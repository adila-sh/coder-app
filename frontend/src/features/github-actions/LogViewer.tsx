import { memo, useEffect, useMemo, useRef } from "react";

type Props = {
  text: string;
  done: boolean;
};

// Remove sequências ANSI (cores, cursor, OSC) e BOM/control chars,
// e ignora linhas vazias com apenas whitespace.
const ANSI_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CTRL_CHARS = /[\x00-\x08\x0B-\x1F\x7F]/g;

function clean(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(ANSI_OSC, "")
    .replace(ANSI_CSI, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(CTRL_CHARS, "")
    .replace(/﻿/g, "");
}

// GitHub prefixa cada linha com timestamp ISO. Extraímos timestamp + conteúdo.
const TS_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s/;

type Line = { ts: string; body: string; kind: "info" | "group" | "error" | "warn" };

function parse(text: string): Line[] {
  const lines = text.split("\n");
  return lines.map((raw) => {
    const m = raw.match(TS_PREFIX);
    const ts = m ? m[1] : "";
    const body = m ? raw.slice(m[0].length) : raw;
    let kind: Line["kind"] = "info";
    if (body.startsWith("##[group]") || body.startsWith("##[endgroup]")) kind = "group";
    else if (body.startsWith("##[error]") || /\bERROR\b/.test(body)) kind = "error";
    else if (body.startsWith("##[warning]") || /\bWARN\b/.test(body)) kind = "warn";
    return { ts, body, kind };
  });
}

function fmtTime(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  const d = new Date(t);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export const LogViewer = memo(function LogViewer({ text, done }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const lines = useMemo(() => parse(clean(text)), [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const slack = 16;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
  };

  if (!text) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground italic">
        {done ? "(sem logs)" : "Aguardando primeiro chunk…"}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className="h-full overflow-auto bg-background text-[11px] leading-[1.5] font-mono select-text"
    >
      <div className="px-3 py-2">
        {lines.map((l, i) => {
          if (!l.body && !l.ts) return null;
          const body = l.body
            .replace(/^##\[group\]/, "▾ ")
            .replace(/^##\[endgroup\]/, "")
            .replace(/^##\[error\]/, "")
            .replace(/^##\[warning\]/, "");
          const cls =
            l.kind === "error"
              ? "text-destructive"
              : l.kind === "warn"
                ? "text-amber-500"
                : l.kind === "group"
                  ? "text-emerald-500 font-medium"
                  : "text-foreground/90";
          return (
            <div key={i} className="flex gap-3 hover:bg-accent/30 -mx-3 px-3 whitespace-pre-wrap">
              <span className="text-muted-foreground shrink-0 select-none tabular-nums w-16">
                {fmtTime(l.ts)}
              </span>
              <span className={"flex-1 min-w-0 " + cls}>{body || " "}</span>
            </div>
          );
        })}
        {!done && (
          <div className="flex gap-3 -mx-3 px-3 mt-1">
            <span className="w-16" />
            <span className="text-emerald-500 inline-flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
              streaming…
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
