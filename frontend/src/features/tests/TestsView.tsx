import { memo, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  FileText,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  StopCircle,
  TestTube,
  X,
  XCircle,
} from "lucide-react";
import { EventsEmit } from "../../../wailsjs/runtime/runtime";
import { LogViewer } from "@/features/github-actions/LogViewer";
import type { TestNode, TestRunSummary, TestRunner, TestStatus } from "./types";
import { useTestsStream } from "./useTestsStream";

type Props = {
  overlayOpen: boolean;
  onClose: () => void;
  rootPath: string;
};

export const TestsView = memo(function TestsView({ overlayOpen, onClose, rootPath }: Props) {
  const stream = useTestsStream();
  const [showLog, setShowLog] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!overlayOpen) return;
    void stream.detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayOpen]);

  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedNodeId) setSelectedNodeId(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayOpen, onClose, selectedNodeId]);

  if (!overlayOpen) return null;

  const selectedId = stream.selectedRunnerId;
  const runner = stream.runners.find((r) => r.id === selectedId) ?? null;
  const summary = selectedId ? (stream.summaryByRunner.get(selectedId) ?? null) : null;
  const nodesMap = selectedId ? (stream.nodesByRunner.get(selectedId) ?? new Map()) : new Map();
  const log = selectedId ? (stream.logsByRunner.get(selectedId) ?? "") : "";
  const isRunning = summary?.status === "running";
  const selectedNode = selectedNodeId ? (nodesMap.get(selectedNodeId) ?? null) : null;

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium min-w-0">
          <TestTube className="size-4 text-emerald-500" />
          <span>Testes</span>
          {runner && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-xs font-normal text-muted-foreground truncate">
                {runner.label}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void stream.detect()}
            title="Re-detectar runners"
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer transition-all duration-150 active:scale-90"
          >
            <RefreshCw className={"size-3.5 " + (stream.loadingRunners ? "animate-spin" : "")} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar (Esc)"
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer transition-all duration-150 active:scale-90"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      {stream.error ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-sm text-center flex flex-col items-center gap-3">
            <div className="size-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="size-6 text-destructive" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Falha ao detectar runners</h2>
              <p className="text-sm text-muted-foreground mt-1">{stream.error}</p>
            </div>
          </div>
        </div>
      ) : stream.runners.length === 0 && !stream.loadingRunners ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-sm text-center flex flex-col items-center gap-3">
            <div className="size-14 rounded-full bg-muted flex items-center justify-center">
              <FlaskConical className="size-6 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">Nenhum test runner detectado</h2>
            <p className="text-sm text-muted-foreground">
              Adicione vitest ao seu package.json, ou abra um projeto Go/Cargo para ver runners
              aqui.
            </p>
          </div>
        </div>
      ) : (
        <div
          className={
            "flex-1 grid min-h-0 " +
            (selectedNode && selectedNode.status === "failed"
              ? "grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]"
              : "grid-cols-[260px_minmax(0,1fr)]")
          }
        >
          <aside className="border-r flex flex-col min-h-0">
            <div className="px-3 py-2 border-b shrink-0 text-[10px] font-medium uppercase text-muted-foreground tracking-wide">
              Runners ({stream.runners.length})
            </div>
            <div className="flex-1 overflow-y-auto scrollbar min-h-0">
              <ul>
                {stream.runners.map((r) => (
                  <RunnerRow
                    key={r.id}
                    runner={r}
                    active={selectedId === r.id}
                    summary={stream.summaryByRunner.get(r.id) ?? null}
                    onClick={() => {
                      stream.select(r.id);
                      setSelectedNodeId(null);
                    }}
                  />
                ))}
              </ul>
            </div>
          </aside>

          {runner ? (
            <RunnerPanel
              runner={runner}
              summary={summary}
              nodesMap={nodesMap}
              log={log}
              showLog={showLog}
              isRunning={isRunning}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onToggleLog={() => setShowLog((v) => !v)}
              onRun={() => {
                setSelectedNodeId(null);
                void stream.run(runner.id);
              }}
              onCancel={() => void stream.cancel()}
            />
          ) : (
            <div className="flex items-center justify-center text-xs text-muted-foreground">
              Selecione um runner à esquerda
            </div>
          )}

          {selectedNode && selectedNode.status === "failed" && runner && (
            <FailureDetail
              node={selectedNode}
              runner={runner}
              rootPath={rootPath}
              onClose={() => setSelectedNodeId(null)}
            />
          )}
        </div>
      )}
    </div>
  );
});

const RunnerRow = memo(function RunnerRow({
  runner,
  active,
  summary,
  onClick,
}: {
  runner: TestRunner;
  active: boolean;
  summary: TestRunSummary | null;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={
          "w-full flex items-start gap-2 px-3 py-2 text-left border-b hover:bg-accent transition-colors cursor-pointer " +
          (active ? "bg-accent" : "")
        }
      >
        <span className="pt-0.5">
          <RunnerKindIcon kind={runner.kind as string} running={summary?.status === "running"} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{runner.label}</div>
          <div className="text-[10px] text-muted-foreground truncate">{runner.detail}</div>
          {summary && (
            <div className="flex items-center gap-1.5 mt-1 text-[10px]">
              {summary.passed > 0 && <span className="text-emerald-500">{summary.passed} ✓</span>}
              {summary.failed > 0 && <span className="text-destructive">{summary.failed} ✗</span>}
              {summary.skipped > 0 && (
                <span className="text-muted-foreground">{summary.skipped} ↷</span>
              )}
              {summary.total === 0 && summary.status !== "running" && (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          )}
        </div>
      </button>
    </li>
  );
});

function RunnerPanel({
  runner,
  summary,
  nodesMap,
  log,
  showLog,
  isRunning,
  selectedNodeId,
  onSelectNode,
  onToggleLog,
  onRun,
  onCancel,
}: {
  runner: TestRunner;
  summary: TestRunSummary | null;
  nodesMap: Map<string, TestNode>;
  log: string;
  showLog: boolean;
  isRunning: boolean;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onToggleLog: () => void;
  onRun: () => void;
  onCancel: () => void;
}) {
  const tree = useMemo(() => buildTree(nodesMap), [nodesMap]);
  const flatNodes = useMemo(() => Array.from(nodesMap.values()), [nodesMap]);

  return (
    <div className="flex flex-col min-h-0 border-r">
      <div className="px-5 py-3 border-b shrink-0 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold truncate">{runner.label}</h2>
            {summary && <SummaryBadge summary={summary} />}
          </div>
          <div className="text-xs text-muted-foreground font-mono truncate mt-0.5">
            {runner.cmd}
          </div>
          {summary && summary.total > 0 && (
            <div className="flex items-center gap-3 mt-2 text-xs">
              <span className="text-emerald-500">
                <CheckCircle2 className="size-3 inline mr-1" />
                {summary.passed} aprovados
              </span>
              {summary.failed > 0 && (
                <span className="text-destructive">
                  <XCircle className="size-3 inline mr-1" />
                  {summary.failed} falhas
                </span>
              )}
              {summary.skipped > 0 && (
                <span className="text-muted-foreground">
                  <CircleDashed className="size-3 inline mr-1" />
                  {summary.skipped} pulados
                </span>
              )}
              <RunDuration summary={summary} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleLog}
            title="Alternar log bruto"
            className={
              "px-2 py-1 rounded text-xs border hover:bg-accent cursor-pointer transition-all duration-150 active:scale-95 " +
              (showLog ? "bg-accent" : "")
            }
          >
            Log
          </button>
          {isRunning ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border hover:bg-accent cursor-pointer transition-all duration-150 active:scale-95"
            >
              <StopCircle className="size-3.5" />
              Parar
            </button>
          ) : (
            <button
              type="button"
              onClick={onRun}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 cursor-pointer transition-all duration-150 active:scale-95"
            >
              <Play className="size-3.5 text-emerald-500" />
              Rodar
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 min-h-0">
        {showLog ? (
          <div className="min-h-0">
            <LogViewer text={log} done={!isRunning} />
          </div>
        ) : (
          <div className="overflow-y-auto scrollbar min-h-0">
            {flatNodes.length === 0 ? (
              <div className="p-6 text-xs text-muted-foreground italic text-center">
                {isRunning
                  ? "Aguardando primeiros resultados…"
                  : "Clique em Rodar para iniciar o test runner"}
              </div>
            ) : (
              <ul className="py-1">
                {tree.map((n) => (
                  <TreeNode
                    key={n.id}
                    node={n}
                    nodesMap={nodesMap}
                    depth={0}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={onSelectNode}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type TreeEntry = {
  id: string;
  children: TreeEntry[];
};

function buildTree(nodesMap: Map<string, TestNode>): TreeEntry[] {
  const childrenById = new Map<string, TreeEntry[]>();
  for (const node of nodesMap.values()) {
    const entry: TreeEntry = { id: node.id, children: [] };
    const list = childrenById.get(node.parentId || "") ?? [];
    list.push(entry);
    childrenById.set(node.parentId || "", list);
  }
  function attach(entry: TreeEntry) {
    const kids = childrenById.get(entry.id) ?? [];
    entry.children = kids;
    for (const k of kids) attach(k);
  }
  const roots = childrenById.get("") ?? [];
  for (const r of roots) attach(r);
  return roots;
}

function TreeNode({
  node,
  nodesMap,
  depth,
  selectedNodeId,
  onSelectNode,
}: {
  node: TreeEntry;
  nodesMap: Map<string, TestNode>;
  depth: number;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const data = nodesMap.get(node.id);
  const [open, setOpen] = useState(true);
  if (!data) return null;
  const hasChildren = node.children.length > 0;
  const isFailed = data.status === "failed";
  const isSelected = selectedNodeId === data.id;
  return (
    <li className="select-text">
      <div
        className={
          "flex items-center gap-1.5 px-3 py-1 transition-colors " +
          (isSelected ? "bg-accent " : "hover:bg-accent/50 ") +
          (isFailed && !data.isSuite ? "cursor-pointer " : "cursor-default ")
        }
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => {
          if (isFailed && !data.isSuite) onSelectNode(isSelected ? null : data.id);
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="size-3" />
        )}
        <StatusGlyph status={data.status} />
        <span
          className={
            "text-xs flex-1 truncate " +
            (data.isSuite ? "font-medium " : "") +
            (data.status === "failed" ? "text-destructive " : "") +
            (data.status === "skipped" ? "text-muted-foreground line-through " : "")
          }
        >
          {data.name || data.id}
        </span>
        {isFailed && !data.isSuite && (
          <span className="text-[10px] text-muted-foreground shrink-0 hidden group-hover:inline">
            ver detalhes
          </span>
        )}
        {data.durationMs > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {fmtDuration(data.durationMs)}
          </span>
        )}
      </div>
      {hasChildren && open && (
        <ul>
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              nodesMap={nodesMap}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function FailureDetail({
  node,
  runner,
  rootPath,
  onClose,
}: {
  node: TestNode;
  runner: TestRunner;
  rootPath: string;
  onClose: () => void;
}) {
  const parsed = useMemo(() => parseVitestFailure(node.failure), [node.failure]);
  const displayText = parsed.rest || node.failure;
  const refs = useMemo(
    () => extractFileRefs(displayText, runner, rootPath),
    [displayText, runner, rootPath],
  );
  const segments = useMemo(() => splitFailureSegments(displayText, refs), [displayText, refs]);
  const atRefs = useMemo(
    () => (parsed.at ? extractFileRefs(parsed.at, runner, rootPath) : []),
    [parsed.at, runner, rootPath],
  );
  const allRefs = useMemo(() => {
    const seen = new Set<string>();
    const list: FileRef[] = [];
    for (const r of [...atRefs, ...refs]) {
      const key = `${r.absPath}:${r.line}:${r.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(r);
    }
    return list;
  }, [atRefs, refs]);

  const onOpenRef = (absPath: string, line: number, col: number) => {
    EventsEmit("editor.openFile", absPath);
    setTimeout(() => EventsEmit("editor.gotoLine", { line, column: col || 1 }), 80);
  };

  return (
    <div className="flex flex-col min-h-0 bg-background/40">
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <XCircle className="size-4 text-destructive shrink-0" />
            <span className="text-sm font-semibold truncate">{node.name}</span>
          </div>
          {node.file && (
            <div className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
              {node.file}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {allRefs.length > 0 && (
        <div className="px-4 py-2 border-b shrink-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
            Localizações ({allRefs.length})
          </div>
          <div className="flex flex-col gap-1">
            {allRefs.map((r, i) => (
              <button
                key={`${r.absPath}-${r.line}-${i}`}
                type="button"
                onClick={() => onOpenRef(r.absPath, r.line, r.col)}
                className="group flex items-center gap-2 text-left text-xs px-2 py-1 rounded hover:bg-accent cursor-pointer transition-all duration-150 active:scale-[0.98]"
                title={r.absPath}
              >
                <FileText className="size-3 text-muted-foreground group-hover:text-foreground shrink-0" />
                <span className="font-mono truncate flex-1">{r.display}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  :{r.line}
                  {r.col > 0 ? `:${r.col}` : ""}
                </span>
                <ExternalLink className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto scrollbar min-h-0 px-4 py-3 flex flex-col gap-3">
        {parsed.message && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-destructive/80 mb-1">
              {parsed.errorName || "Erro"}
            </div>
            <pre className="text-[12px] font-mono whitespace-pre-wrap leading-[1.5] text-foreground">
              {parsed.message}
            </pre>
          </div>
        )}

        {(parsed.actual || parsed.expected) && (
          <div className="grid grid-cols-2 gap-2">
            <DiffPanel label="Actual" tone="actual" body={parsed.actual ?? ""} />
            <DiffPanel label="Expected" tone="expected" body={parsed.expected ?? ""} />
          </div>
        )}

        {segments.length > 0 && (
          <details className="group" open={!parsed.message && !parsed.actual && !parsed.expected}>
            <summary className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground">
              Saída bruta
            </summary>
            <pre className="text-[11px] font-mono whitespace-pre-wrap leading-[1.55] text-foreground/80 mt-2">
              {segments.map((seg, i) =>
                seg.kind === "ref" ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onOpenRef(seg.ref.absPath, seg.ref.line, seg.ref.col)}
                    className="text-sky-500 hover:underline cursor-pointer"
                    title={`Abrir ${seg.ref.absPath}:${seg.ref.line}`}
                  >
                    {seg.text}
                  </button>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </pre>
          </details>
        )}

        {!parsed.message && !parsed.actual && !parsed.expected && segments.length === 0 && (
          <span className="text-muted-foreground italic text-xs">(sem detalhes)</span>
        )}
      </div>
    </div>
  );
}

function DiffPanel({
  label,
  tone,
  body,
}: {
  label: string;
  tone: "actual" | "expected";
  body: string;
}) {
  const tint =
    tone === "actual"
      ? "border-rose-500/30 bg-rose-500/5"
      : "border-emerald-500/30 bg-emerald-500/5";
  const labelTint = tone === "actual" ? "text-rose-400" : "text-emerald-400";
  const formatted = useMemo(() => formatDiffBody(body), [body]);
  return (
    <div className={`rounded-md border ${tint} flex flex-col min-h-0`}>
      <div className={`text-[10px] font-medium uppercase tracking-wide px-3 py-1.5 ${labelTint}`}>
        {label}
      </div>
      <pre className="text-[11px] font-mono whitespace-pre-wrap leading-[1.5] px-3 pb-2 overflow-auto scrollbar text-foreground/90">
        {formatted || "(vazio)"}
      </pre>
    </div>
  );
}

type FileRef = {
  raw: string;
  display: string;
  absPath: string;
  line: number;
  col: number;
  index: number;
  length: number;
};

const FILE_REF_REGEX =
  /([\w\-./]+\.(?:go|ts|tsx|js|jsx|mjs|cjs|rs|py|java|kt|rb|php|cpp|c|h|hpp))(?::(\d+))(?::(\d+))?/g;

function extractFileRefs(failure: string, runner: TestRunner, rootPath: string): FileRef[] {
  if (!failure) return [];
  const refs: FileRef[] = [];
  const re = new RegExp(FILE_REF_REGEX);
  let m: RegExpExecArray | null;
  while ((m = re.exec(failure)) !== null) {
    const rel = m[1];
    const line = parseInt(m[2], 10);
    const col = m[3] ? parseInt(m[3], 10) : 0;
    const absPath = resolvePath(rel, runner, rootPath);
    refs.push({
      raw: m[0],
      display: rel,
      absPath,
      line,
      col,
      index: m.index,
      length: m[0].length,
    });
  }
  return refs;
}

function resolvePath(rel: string, runner: TestRunner, rootPath: string): string {
  if (rel.startsWith("/")) return rel;
  // Go: o pacote tem caminho tipo "github.com/foo/bar" — mas o output tem o
  // basename do arquivo (ex: "tests.go:10"). O cwd do `go test` é o root.
  // Vitest/cargo: cwd é runner.cwd. Joina com rootPath/runner.cwd.
  const base = runner.cwd || rootPath || "";
  if (!base) return rel;
  return base.endsWith("/") ? base + rel : base + "/" + rel;
}

type Segment = { kind: "text"; text: string } | { kind: "ref"; text: string; ref: FileRef };

type ParsedFailure = {
  errorName?: string;
  message?: string;
  at?: string;
  actual?: string;
  expected?: string;
  rest?: string;
};

const TOP_LEVEL_KEYS = new Set([
  "error",
  "at",
  "actual",
  "expected",
  "stack",
  "operator",
  "diff",
  "showDiff",
]);

// Vitest TAP escapa o corpo de strings como `"…"` (com `\"` internos) ou usa
// blocos multi-linha indentados. Esta função desestrutura tanto strings inline
// quanto blocos em vários níveis, devolvendo o conteúdo "limpo" para exibição.
function parseVitestFailure(raw: string): ParsedFailure {
  if (!raw || !raw.trim()) return {};
  const lines = raw.replace(/\r/g, "").split("\n");
  const out: ParsedFailure = {};
  const leftover: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    const kv = matchKeyValue(trimmed);
    if (kv && (TOP_LEVEL_KEYS.has(kv.key) || kv.key === "name" || kv.key === "message")) {
      const indent = leadingWs(line);
      let value: string;
      if (kv.value === "") {
        const block = collectBlock(lines, i + 1, indent.length);
        value = block.text;
        i = block.next;
      } else {
        value = unquote(kv.value);
        i++;
      }
      assignField(out, kv.key, value);
      continue;
    }
    leftover.push(line);
    i++;
  }

  if (leftover.length > 0) {
    out.rest = leftover.join("\n").replace(/^\n+|\n+$/g, "");
  }
  return out;
}

function matchKeyValue(line: string): { key: string; value: string } | null {
  const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
  if (!m) return null;
  return { key: m[1], value: m[2] };
}

function leadingWs(line: string): string {
  const m = /^\s*/.exec(line);
  return m ? m[0] : "";
}

function collectBlock(
  lines: string[],
  start: number,
  parentIndent: number,
): { text: string; next: number } {
  const buf: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      buf.push("");
      i++;
      continue;
    }
    const indent = leadingWs(line).length;
    if (indent <= parentIndent) break;
    buf.push(line.slice(parentIndent + 2 <= indent ? parentIndent + 2 : indent));
    i++;
  }
  return { text: buf.join("\n").replace(/^\n+|\n+$/g, ""), next: i };
}

function unquote(value: string): string {
  let v = value.trim();
  if (v.startsWith("|") || v.startsWith(">")) v = v.slice(1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function assignField(out: ParsedFailure, key: string, value: string) {
  switch (key) {
    case "name":
      out.errorName = value;
      break;
    case "message":
      out.message = value;
      break;
    case "at":
      out.at = value;
      break;
    case "actual":
      out.actual = value;
      break;
    case "expected":
      out.expected = value;
      break;
    case "error": {
      // Bloco aninhado: re-parse para pegar name/message dentro.
      const inner = parseVitestFailure(value);
      if (inner.errorName) out.errorName = inner.errorName;
      if (inner.message) out.message = inner.message;
      else if (!out.message && value.trim()) out.message = value;
      break;
    }
    case "stack":
      out.rest = (out.rest ? out.rest + "\n\n" : "") + value;
      break;
  }
}

function formatDiffBody(body: string): string {
  if (!body) return "";
  const trimmed = body.trim();
  // Tenta JSON: às vezes vem como `{...}` ou `[...]` em uma linha.
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // segue para fallback
    }
  }
  // Reformata o "Array [\nObject {…}\n]" do vitest dropando indent estranho.
  return trimmed
    .split("\n")
    .map((l) => l.replace(/^\s{2,}/, (m) => " ".repeat(Math.min(m.length, 4))))
    .join("\n");
}

function splitFailureSegments(failure: string, refs: FileRef[]): Segment[] {
  if (!failure) return [];
  if (refs.length === 0) return [{ kind: "text", text: failure }];
  const out: Segment[] = [];
  let cursor = 0;
  for (const r of refs) {
    if (r.index > cursor) {
      out.push({ kind: "text", text: failure.slice(cursor, r.index) });
    }
    out.push({ kind: "ref", text: r.raw, ref: r });
    cursor = r.index + r.length;
  }
  if (cursor < failure.length) {
    out.push({ kind: "text", text: failure.slice(cursor) });
  }
  return out;
}

function StatusGlyph({ status }: { status: TestStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-3 shrink-0 text-amber-500 animate-spin" />;
    case "passed":
      return <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />;
    case "failed":
      return <XCircle className="size-3 shrink-0 text-destructive" />;
    case "skipped":
      return <CircleDashed className="size-3 shrink-0 text-muted-foreground" />;
    default:
      return <span className="size-3 shrink-0 rounded-full border border-border" />;
  }
}

function RunnerKindIcon({ kind, running }: { kind: string; running?: boolean }) {
  if (running) return <Loader2 className="size-3.5 text-amber-500 animate-spin" />;
  if (kind === "vitest") return <FlaskConical className="size-3.5 text-emerald-500" />;
  if (kind === "go") return <TestTube className="size-3.5 text-sky-500" />;
  if (kind === "cargo") return <TestTube className="size-3.5 text-orange-500" />;
  return <TestTube className="size-3.5 text-muted-foreground" />;
}

function SummaryBadge({ summary }: { summary: TestRunSummary }) {
  let label = "";
  let cls = "bg-muted text-muted-foreground";
  if (summary.status === "running") {
    label = "Em execução";
    cls = "bg-amber-500/10 text-amber-600 border border-amber-500/20";
  } else if (summary.status === "completed") {
    if (summary.failed > 0) {
      label = "Falha";
      cls = "bg-destructive/10 text-destructive border border-destructive/20";
    } else {
      label = "Sucesso";
      cls = "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20";
    }
  } else if (summary.status === "cancelled") {
    label = "Cancelado";
    cls = "bg-muted text-muted-foreground border";
  } else if (summary.status === "error") {
    label = "Erro";
    cls = "bg-destructive/10 text-destructive border border-destructive/20";
  }
  return (
    <span className={"text-[10px] font-medium uppercase tracking-wide rounded px-1.5 py-px " + cls}>
      {label}
    </span>
  );
}

function RunDuration({ summary }: { summary: TestRunSummary }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (summary.status !== "running") return;
    const t = setInterval(() => force((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [summary.status]);
  const end = summary.status === "running" ? Date.now() : summary.finishedAt || Date.now();
  const ms = Math.max(0, end - summary.startedAt);
  return <span className="text-muted-foreground tabular-nums">{fmtDuration(ms)}</span>;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s % 60)}s`;
}
