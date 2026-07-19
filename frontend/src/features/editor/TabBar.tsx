import { memo, useRef, useState } from "react";
import { Globe, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { SymbolIcon } from "@/components/SymbolIcon";
import { isWebviewPath, webviewLabel } from "./WebView";

type Tab = { path: string; content: string; dirty: boolean };

type Props = {
  tabs: Tab[];
  activePath: string;
  paneId?: string;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
};

const TAB_SPRING = { type: "spring" as const, stiffness: 480, damping: 36 };

export const TabBar = memo(function TabBar({
  tabs,
  activePath,
  paneId,
  onActivate,
  onClose,
  onReorder,
}: Props) {
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const dragIndexRef = useRef<number>(-1);

  function handleDragStart(e: React.DragEvent, index: number) {
    dragIndexRef.current = index;
    const tab = tabs[index];
    if (tab && paneId) {
      // permite drop em outro pane via mesmo MIME — payload inclui fromPaneId
      e.dataTransfer.setData(
        "application/x-adila-file",
        JSON.stringify({
          path: tab.path,
          name: tab.path.split(/[\\/]/).pop() || tab.path,
          fromPaneId: paneId,
        }),
      );
      e.dataTransfer.effectAllowed = "copyMove";
    } else {
      e.dataTransfer.effectAllowed = "move";
    }
    // ghost image transparente — a tab em si já dá o feedback visual
    e.dataTransfer.setDragImage(e.currentTarget as HTMLElement, 0, 0);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    // só intercepta se for reorder dentro deste TabBar — caso contrário deixa
    // bubble para LeafView (drop entre panes)
    if (dragIndexRef.current === -1) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(index);
  }

  function handleDrop(e: React.DragEvent, toIndex: number) {
    const from = dragIndexRef.current;
    if (from === -1) return; // não é reorder local — deixa LeafView tratar
    e.preventDefault();
    if (from !== toIndex) {
      onReorder(from, toIndex);
    }
    setDragOver(null);
    dragIndexRef.current = -1;
  }

  function handleDragEnd() {
    setDragOver(null);
    dragIndexRef.current = -1;
  }

  return (
    <div
      className="flex border-b overflow-x-auto bg-gradient-to-b from-muted/10 via-muted/25 to-muted/45 shrink-0"
      onDragLeave={() => setDragOver(null)}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {tabs.map((t, i) => {
          const isWeb = isWebviewPath(t.path);
          const name = isWeb ? webviewLabel(t.path) : t.path.split(/[\\/]/).pop() || t.path;
          const active = t.path === activePath;
          const isDragging = dragIndexRef.current === i;
          const isDropTarget = dragOver === i && dragIndexRef.current !== i;
          const isHovered = hoverPath === t.path;
          // Dot dirty tem prioridade quando não há hover (mesmo na aba ativa) —
          // assim a aba que você está editando ainda mostra "modificada".
          // Ao passar o mouse, troca pelo X pra permitir fechar.
          const showDirtyDot = t.dirty && !isHovered;
          const showClose = !showDirtyDot;

          return (
            <motion.div
              key={t.path}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              draggable
              // motion.div tipa onDragStart/Over/Drop com a união dos eventos
              // de input touch+pointer+mouse pra suportar drag motion-driven.
              // Aqui usamos drag HTML5 nativo (`draggable`), então o runtime
              // entrega DragEvent — o cast só re-alinha os tipos.
              onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, i)}
              onDragOver={(e) => handleDragOver(e as unknown as React.DragEvent, i)}
              onDrop={(e) => handleDrop(e as unknown as React.DragEvent, i)}
              onDragEnd={handleDragEnd}
              onClick={() => onActivate(t.path)}
              onMouseEnter={() => setHoverPath(t.path)}
              onMouseLeave={() => setHoverPath((p) => (p === t.path ? null : p))}
              className={cn(
                "group relative flex items-center gap-2 px-3 py-1.5 border-r text-sm cursor-pointer select-none shrink-0",
                isDragging && "opacity-40",
                isDropTarget && "bg-accent/60",
              )}
            >
              {/* Hover glow para abas inativas */}
              {!active && (
                <motion.span
                  initial={false}
                  animate={{ opacity: isHovered ? 1 : 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 bg-accent/70"
                />
              )}

              {/* Background + underline da aba ativa — um único layoutId compartilhado
                  evita 2-3 transições desencontradas quando muda a tab ativa. */}
              {active && (
                <motion.span
                  layoutId={`tab-active-${paneId ?? "root"}`}
                  transition={TAB_SPRING}
                  className="absolute inset-0 bg-background after:absolute after:left-0 after:right-0 after:bottom-0 after:h-[2px] after:bg-primary"
                />
              )}

              {/* Indicador de drop à esquerda */}
              <AnimatePresence>
                {isDropTarget && (
                  <motion.span
                    key="drop-indicator"
                    initial={{ scaleY: 0, opacity: 0 }}
                    animate={{ scaleY: 1, opacity: 1 }}
                    exit={{ scaleY: 0, opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="absolute left-0 top-1 bottom-1 w-0.5 bg-primary rounded-full z-10 origin-center"
                  />
                )}
              </AnimatePresence>

              <span className="size-4 shrink-0 relative z-10 flex items-center justify-center">
                {isWeb ? (
                  <Globe
                    className={cn("size-4", active ? "text-foreground" : "text-muted-foreground")}
                  />
                ) : (
                  <SymbolIcon name={name} isDir={false} className="size-4" />
                )}
              </span>

              <span
                title={t.path}
                className={cn(
                  "truncate max-w-[12rem] relative z-10",
                  active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                )}
              >
                {name}
              </span>

              {/* Slot trailing: dot quando dirty + não hover, X caso contrário.
                  Sem AnimatePresence/scale: troca instantânea evita flicker. */}
              <div className="relative z-10 size-5 shrink-0 flex items-center justify-center">
                {showDirtyDot ? (
                  <span
                    aria-label="Modificado"
                    title="Modificado — não salvo"
                    className="size-1.5 rounded-full bg-primary"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onClose(t.path);
                    }}
                    className={cn(
                      "cursor-pointer rounded p-0.5 hover:bg-foreground/10 hover:text-foreground",
                      active ? "text-foreground/70" : "text-muted-foreground",
                    )}
                    aria-label="Fechar aba"
                    title="Fechar aba (Ctrl+W)"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
});
