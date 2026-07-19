/**
 * Renderização recursiva da árvore de panes do editor.
 *
 * Usa HTML5 drag-and-drop nativo (consistente com TabBar). Cada leaf desenha
 * um overlay de drop quando há um drag ativo, com 5 zonas (center, left,
 * right, top, bottom) — estilo Ubuntu window-tile.
 */

import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Suspense, lazy, memo, useCallback, useEffect, useRef, useState } from "react";
import { useConfig } from "@/hooks/useConfig";
import { Breadcrumbs } from "./Breadcrumbs";
import type { EditorMarker } from "./ProblemsPanel";
import { TabBar } from "./TabBar";
import { isWebviewPath } from "./WebView";
import type { DropSide, LeafPane, PaneId, PaneNode } from "./panes";

const CodeEditor = lazy(() => import("./CodeEditor").then((m) => ({ default: m.CodeEditor })));
const AdilaEditor = lazy(() => import("./adila-editor").then((m) => ({ default: m.AdilaEditor })));
const WebView = lazy(() => import("./WebView").then((m) => ({ default: m.WebView })));

export const FILE_DRAG_MIME = "application/x-adila-file";

export type DraggedFile = { path: string; name: string; fromPaneId?: PaneId };

function ViewFallback() {
  return (
    <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
      Carregando…
    </div>
  );
}

type PaneTreeProps = {
  root: PaneNode;
  rootPath: string;
  focusedPaneId: PaneId;
  onFocusPane: (id: PaneId) => void;
  onActivateTab: (paneId: PaneId, path: string) => void;
  onCloseTab: (paneId: PaneId, path: string) => void;
  onReorderTabs: (paneId: PaneId, fromIndex: number, toIndex: number) => void;
  onChange: (path: string, content: string) => void;
  onCursorChange: (line: number, column: number) => void;
  onMarkersChange: (path: string, markers: EditorMarker[]) => void;
  onDropFile: (paneId: PaneId, side: DropSide, file: DraggedFile) => void;
  onSplitSizeChange?: (splitId: PaneId, size: number) => void;
  onOpenFileByPath: (path: string) => void;
  onWebviewNavigate?: (paneId: PaneId, oldPath: string, newPath: string) => void;
  emptyState: React.ReactNode;
};

export const PaneTree = memo(function PaneTree(props: PaneTreeProps) {
  return <PaneNodeView node={props.root} {...props} />;
});

function PaneNodeView({ node, ...props }: { node: PaneNode } & PaneTreeProps) {
  if (node.kind === "leaf") {
    return <LeafView leaf={node} {...props} />;
  }

  return <SplitView node={node} {...props} />;
}

function SplitView({
  node,
  ...props
}: { node: Extract<PaneNode, { kind: "split" }> } & PaneTreeProps) {
  const orientation = node.direction === "horizontal" ? "horizontal" : "vertical";
  const idA = `${node.id}-a`;
  const idB = `${node.id}-b`;

  // Persistência debouncada: allotment já cuida do visual durante o drag via
  // manipulação direta do DOM. Só propagamos para o estado do App quando o
  // usuário para de arrastar — assim Monaco não re-renderiza por pixel.
  const commitTimer = useRef<number | undefined>(undefined);
  const onSplitSizeChange = props.onSplitSizeChange;
  const containerSizeRef = useRef<number>(0);
  const handleLayoutChanged = useCallback(
    (sizes: number[]) => {
      const aPx = sizes[0];
      if (typeof aPx !== "number") return;
      const total = sizes.reduce((acc, n) => acc + n, 0);
      if (total <= 0) return;
      containerSizeRef.current = total;
      const aPct = (aPx / total) * 100;
      if (Math.round(aPct) === Math.round(node.size)) return;
      if (commitTimer.current !== undefined) {
        window.clearTimeout(commitTimer.current);
      }
      commitTimer.current = window.setTimeout(() => {
        commitTimer.current = undefined;
        onSplitSizeChange?.(node.id, aPct);
      }, 150);
    },
    [node.id, node.size, onSplitSizeChange],
  );
  useEffect(() => {
    return () => {
      if (commitTimer.current !== undefined) window.clearTimeout(commitTimer.current);
    };
  }, []);

  return (
    <ResizablePanelGroup
      orientation={orientation}
      className="flex-1 min-h-0"
      onLayoutChanged={handleLayoutChanged}
    >
      <ResizablePanel key={idA} preferredSize={`${node.size}%`} minSize={120}>
        <div className="flex flex-col overflow-hidden h-full">
          <PaneNodeView node={node.a} {...props} />
        </div>
      </ResizablePanel>
      <ResizablePanel key={idB} preferredSize={`${100 - node.size}%`} minSize={120}>
        <div className="flex flex-col overflow-hidden h-full">
          <PaneNodeView node={node.b} {...props} />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function LeafView({
  leaf,
  rootPath,
  focusedPaneId,
  onFocusPane,
  onActivateTab,
  onCloseTab,
  onReorderTabs,
  onChange,
  onCursorChange,
  onMarkersChange,
  onDropFile,
  onOpenFileByPath,
  onWebviewNavigate,
  emptyState,
}: { leaf: LeafPane } & PaneTreeProps) {
  const [dropSide, setDropSide] = useState<DropSide | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Contador de enter/leave: o navegador dispara dragleave/dragenter ao cruzar
  // qualquer filho (TabBar, breadcrumbs, Monaco). Só limpamos o overlay quando
  // o contador volta a zero — robusto contra relatedTarget=null no webkit.
  const dragDepth = useRef(0);
  const isFocused = leaf.id === focusedPaneId;

  useEffect(() => {
    // Garante limpeza se o usuário soltar fora do app ou cancelar com Esc.
    function clear() {
      dragDepth.current = 0;
      setDragActive(false);
      setDropSide(null);
    }
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);

  const activeTab = leaf.tabs.find((t) => t.path === leaf.activePath);

  function isFileDrag(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes(FILE_DRAG_MIME);
  }

  function computeSide(e: React.DragEvent): DropSide {
    const el = containerRef.current;
    if (!el) return "left";
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    // 4 zonas: split horizontal (left | right) ou vertical (top | bottom).
    // Quem ganha é o eixo com maior distância à borda oposta.
    const distLeft = x;
    const distRight = 1 - x;
    const distTop = y;
    const distBottom = 1 - y;
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);
    if (minDist === distLeft) return "left";
    if (minDist === distRight) return "right";
    if (minDist === distTop) return "top";
    return "bottom";
  }

  function handleDragEnter(e: React.DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    if (!dragActive) setDragActive(true);
  }

  function handleDragOver(e: React.DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropSide(computeSide(e));
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!isFileDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setDragActive(false);
      setDropSide(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    const raw = e.dataTransfer.getData(FILE_DRAG_MIME);
    dragDepth.current = 0;
    setDragActive(false);
    setDropSide(null);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as DraggedFile;
      const side = computeSide(e);
      onDropFile(leaf.id, side, parsed);
    } catch {
      // ignore
    }
  }

  return (
    <div
      ref={containerRef}
      onClick={() => !isFocused && onFocusPane(leaf.id)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex flex-col overflow-hidden h-full min-h-0 flex-1"
    >
      {/* TabBar */}
      <div className="flex items-center border-b shrink-0">
        <div className="flex-1 overflow-hidden min-w-0">
          <TabBar
            tabs={leaf.tabs}
            activePath={leaf.activePath}
            paneId={leaf.id}
            onActivate={(path) => onActivateTab(leaf.id, path)}
            onClose={(path) => onCloseTab(leaf.id, path)}
            onReorder={(from, to) => onReorderTabs(leaf.id, from, to)}
          />
        </div>
      </div>

      {/* Breadcrumbs + editor.
          O componente é renderizado por leaf, então usar useConfig aqui é
          aceitável (até 4 panes no layout máximo). Default true: mantém o
          comportamento atual de quem nunca tocou na config. */}
      {activeTab && !isWebviewPath(activeTab.path) && (
        <BreadcrumbsGate path={activeTab.path} rootPath={rootPath} onOpenFile={onOpenFileByPath} />
      )}
      <div className="relative flex-1 overflow-hidden min-h-0">
        {activeTab ? (
          isWebviewPath(activeTab.path) ? (
            <Suspense fallback={<ViewFallback />}>
              <WebView
                path={activeTab.path}
                onNavigate={(oldPath, newPath) => onWebviewNavigate?.(leaf.id, oldPath, newPath)}
              />
            </Suspense>
          ) : (
            <Suspense fallback={<ViewFallback />}>
              <EditorRouter
                path={activeTab.path}
                content={activeTab.content}
                rootUri={rootPath ? `file://${rootPath}` : undefined}
                onChange={(v) => onChange(activeTab.path, v)}
                onCursorChange={isFocused ? onCursorChange : undefined}
                onMarkersChange={onMarkersChange}
              />
            </Suspense>
          )
        ) : (
          emptyState
        )}
      </div>

      {/* Indicador de pane focado (sutil ring no top do leaf) */}
      {isFocused && leaf.tabs.length > 0 && (
        <span className="pointer-events-none absolute left-0 right-0 top-0 h-px bg-primary/40" />
      )}

      {/* Drop overlay — visível apenas durante drag */}
      {dragActive && <DropOverlay side={dropSide} />}
    </div>
  );
}

function DropOverlay({ side }: { side: DropSide | null }) {
  // Cada zona renderizada com posição absoluta e highlight quando ativa
  const ZONE = 25; // % de cada borda
  const cls = (active: boolean) =>
    [
      "absolute pointer-events-none transition-colors",
      active ? "bg-primary/20 border-2 border-primary" : "bg-transparent border border-primary/20",
    ].join(" ");

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {/* left */}
      <div
        className={cls(side === "left")}
        style={{ top: 0, bottom: 0, left: 0, width: `${ZONE}%` }}
      />
      {/* right */}
      <div
        className={cls(side === "right")}
        style={{ top: 0, bottom: 0, right: 0, width: `${ZONE}%` }}
      />
      {/* top */}
      <div
        className={cls(side === "top")}
        style={{
          top: 0,
          left: `${ZONE}%`,
          right: `${ZONE}%`,
          height: `${ZONE}%`,
        }}
      />
      {/* bottom */}
      <div
        className={cls(side === "bottom")}
        style={{
          bottom: 0,
          left: `${ZONE}%`,
          right: `${ZONE}%`,
          height: `${ZONE}%`,
        }}
      />
    </div>
  );
}

// EditorRouter decide entre Monaco (default) e AdilaEditor baseado em
// workbench.newEditor. Mantém isolado pra re-render desse subtree apenas
// quando o usuário troca o toggle.
function EditorRouter(props: {
  path: string;
  content: string;
  rootUri?: string;
  onChange: (v: string) => void;
  onCursorChange?: (line: number, column: number) => void;
  onMarkersChange?: (path: string, markers: EditorMarker[]) => void;
}) {
  const { value: useNew } = useConfig<boolean>("workbench.newEditor", false);
  if (useNew) {
    return <AdilaEditor {...props} />;
  }
  return <CodeEditor {...props} />;
}

// BreadcrumbsGate consulta editor.breadcrumbs.enabled antes de montar o
// componente real. Isolado pra que a tipagem `useConfig<boolean>` re-renderize
// só esse subtree quando o usuário troca o toggle, sem afetar o LeafView
// inteiro (que tem state pesado de drag-and-drop).
function BreadcrumbsGate({
  path,
  rootPath,
  onOpenFile,
}: {
  path: string;
  rootPath: string;
  onOpenFile: (path: string) => void;
}) {
  const { value: enabled } = useConfig<boolean>("editor.breadcrumbs.enabled", true);
  if (!enabled) return null;
  return <Breadcrumbs path={path} rootPath={rootPath} onOpenFile={onOpenFile} />;
}
