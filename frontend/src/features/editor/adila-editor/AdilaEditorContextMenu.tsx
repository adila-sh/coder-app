import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorStore } from "./state/editorStore";
import { cursorRange, cursorHasSelection } from "./cursor/cursorState";
import { useUiStore } from "@/stores/uiStore";
import { EventsEmit } from "../../../../wailsjs/runtime/runtime";
import { copyToClipboard } from "@/hooks/useToast";
import type { LspApi } from "./lsp/useAdilaLSP";

type Position = { x: number; y: number };

type Props = {
  store: EditorStore;
  filePath: string;
  lspApi?: LspApi;
  children: React.ReactNode;
};

export function AdilaEditorContextMenu({ store, filePath, lspApi, children }: Props) {
  const [pos, setPos] = useState<Position | null>(null);

  return (
    <div
      className="h-full w-full"
      onContextMenu={(e) => {
        e.preventDefault();
        setPos({ x: e.clientX, y: e.clientY });
      }}
    >
      {children}
      {pos && (
        <Menu
          pos={pos}
          store={store}
          filePath={filePath}
          lspApi={lspApi}
          onClose={() => setPos(null)}
        />
      )}
    </div>
  );
}

type Item =
  | { kind: "item"; label: string; shortcut?: string; onSelect: () => void; disabled?: boolean }
  | { kind: "separator" };

function buildItems(
  store: EditorStore,
  filePath: string,
  lspApi: LspApi | undefined,
  close: () => void,
): Item[] {
  const s = store.getState();
  const primary = s.cursors[0];
  const hasSel = primary ? cursorHasSelection(primary) : false;
  const lspAvailable = !!lspApi?.available;

  async function gotoDefinition() {
    if (!lspApi || !primary) return;
    try {
      const res = await lspApi.definition(primary.pos.line, primary.pos.col);
      if (!res) return;
      const first = Array.isArray(res) ? res[0] : res;
      if (!first) return;
      const uri = "targetUri" in first ? first.targetUri : first.uri;
      const range = "targetSelectionRange" in first ? first.targetSelectionRange : first.range;
      if (!uri || !range) return;
      const path = decodeURIComponent(uri.replace(/^file:\/\//, ""));
      EventsEmit("editor.openFile", path);
      setTimeout(
        () =>
          EventsEmit("editor.gotoLine", {
            line: range.start.line + 1,
            column: range.start.character + 1,
          }),
        80,
      );
    } catch (err) {
      console.error(err);
    }
  }

  function selectionText(): string {
    if (!primary || !hasSel) return "";
    return s.buffer.getRangeText(cursorRange(primary));
  }

  function deleteSelection() {
    if (!hasSel || !primary) return;
    const r = cursorRange(primary);
    s.edit(
      [{ range: r, text: "" }],
      [{ pos: r.start, anchor: r.start, desiredCol: r.start.col }],
      "cut",
    );
  }

  const items: Item[] = [
    {
      kind: "item",
      label: "Ir para definição",
      shortcut: "F12",
      disabled: !lspAvailable,
      onSelect: async () => {
        await gotoDefinition();
        close();
      },
    },
    { kind: "separator" },
    {
      kind: "item",
      label: "Recortar",
      shortcut: "Ctrl+X",
      disabled: !hasSel,
      onSelect: async () => {
        const text = selectionText();
        if (text) {
          const ok = await copyToClipboard(text);
          if (ok) deleteSelection();
        }
        close();
      },
    },
    {
      kind: "item",
      label: "Copiar",
      shortcut: "Ctrl+C",
      disabled: !hasSel,
      onSelect: async () => {
        const text = selectionText();
        if (text) await copyToClipboard(text);
        close();
      },
    },
    {
      kind: "item",
      label: "Colar",
      shortcut: "Ctrl+V",
      onSelect: async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) store.getState().insertText(text);
        } catch (err) {
          console.error(err);
        }
        close();
      },
    },
    { kind: "separator" },
    {
      kind: "item",
      label: "Selecionar tudo",
      shortcut: "Ctrl+A",
      onSelect: () => {
        const buf = store.getState().buffer;
        const lastLine = buf.getLineCount() - 1;
        const lastCol = buf.getLineLength(lastLine);
        store.getState().setCursors([
          {
            pos: { line: lastLine, col: lastCol },
            anchor: { line: 0, col: 0 },
            desiredCol: lastCol,
          },
        ]);
        close();
      },
    },
    { kind: "separator" },
    {
      kind: "item",
      label: "Copiar caminho do arquivo",
      onSelect: async () => {
        await copyToClipboard(filePath, filePath);
        close();
      },
    },
    {
      kind: "item",
      label: "Copiar nome do arquivo",
      onSelect: async () => {
        const name = filePath.split(/[\\/]/).pop() ?? filePath;
        await copyToClipboard(name, name);
        close();
      },
    },
    { kind: "separator" },
    {
      kind: "item",
      label: "Paleta de comandos",
      shortcut: "Ctrl+Shift+P",
      onSelect: () => {
        useUiStore.getState().setQuickOpenOpen(true);
        close();
      },
    },
  ];

  return items;
}

type MenuProps = {
  pos: Position;
  store: EditorStore;
  filePath: string;
  lspApi?: LspApi;
  onClose: () => void;
};

function Menu({ pos, store, filePath, lspApi, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<Position>(pos);
  const items = buildItems(store, filePath, lspApi, onClose);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = pos.x;
    let y = pos.y;
    if (x + rect.width > vw - 8) x = Math.max(8, vw - rect.width - 8);
    if (y + rect.height > vh - 8) y = Math.max(8, vh - rect.height - 8);
    setAdjusted({ x, y });
  }, [pos]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[240px] py-1 rounded-md border bg-popover text-popover-foreground shadow-lg outline-none animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ left: adjusted.x, top: adjusted.y }}
      role="menu"
    >
      {items.map((item, i) =>
        item.kind === "separator" ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={`item-${i}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={item.onSelect}
            className="w-full flex items-center justify-between gap-6 px-3 py-1.5 text-sm text-left outline-none transition-colors cursor-pointer enabled:hover:bg-accent enabled:hover:text-accent-foreground enabled:focus:bg-accent enabled:focus:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="truncate">{item.label}</span>
            {item.shortcut && (
              <span className="shrink-0 text-[11px] text-muted-foreground tracking-wide font-mono">
                {item.shortcut}
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
}
