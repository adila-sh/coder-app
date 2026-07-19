import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as proto from "vscode-languageserver-protocol";

type Props = {
  items: proto.CompletionItem[];
  /** Filtro atual (texto já digitado do identificador). */
  filter: string;
  anchorX: number;
  anchorY: number;
  lineHeight: number;
  onAccept: (item: proto.CompletionItem) => void;
  onClose: () => void;
};

const KIND_LABEL: Record<number, string> = {
  1: "Text",
  2: "Method",
  3: "Function",
  4: "Constructor",
  5: "Field",
  6: "Variable",
  7: "Class",
  8: "Interface",
  9: "Module",
  10: "Property",
  12: "Value",
  13: "Enum",
  14: "Keyword",
  15: "Snippet",
  21: "Constant",
  22: "Struct",
  25: "TypeParameter",
};

export function CompletionPopup({
  items,
  filter,
  anchorX,
  anchorY,
  lineHeight,
  onAccept,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: anchorX, y: anchorY + lineHeight });
  const [selected, setSelected] = useState(0);

  const filtered = filter
    ? items.filter((it) => {
        const label = (it.filterText ?? (it.label as string)).toLowerCase();
        return label.includes(filter.toLowerCase());
      })
    : items;

  const visible = filtered.slice(0, 50);

  useEffect(() => {
    setSelected(0);
  }, [filter, items]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = anchorX;
    let y = anchorY + lineHeight;
    if (x + rect.width > vw - 8) x = Math.max(8, vw - rect.width - 8);
    if (y + rect.height > vh - 8) y = Math.max(8, anchorY - rect.height - 4);
    setPos({ x, y });
  }, [anchorX, anchorY, lineHeight]);

  // Keyboard handling — escutamos no document pra interceptar antes do
  // textarea do editor.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (visible.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((s) => (s + 1) % visible.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((s) => (s - 1 + visible.length) % visible.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        onAccept(visible[selected]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, selected, onAccept, onClose]);

  // Auto-scroll do item selecionado.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selected] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (visible.length === 0) return null;

  return (
    <div
      ref={ref}
      className="fixed z-[95] w-[360px] max-h-[280px] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg text-xs animate-in fade-in-0 duration-100"
      style={{ left: pos.x, top: pos.y }}
    >
      <div ref={listRef} className="overflow-auto max-h-[280px]">
        {visible.map((it, i) => {
          const label = it.label as string;
          const kind = KIND_LABEL[it.kind ?? 0] ?? "";
          const isSel = i === selected;
          return (
            <button
              type="button"
              key={`${label}-${i}`}
              onClick={() => onAccept(it)}
              className={`w-full flex items-center gap-2 px-2.5 py-1 text-left transition-colors ${
                isSel ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              }`}
            >
              <span className="font-mono truncate flex-1">{label}</span>
              {kind && <span className="shrink-0 text-[10px] text-muted-foreground">{kind}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
