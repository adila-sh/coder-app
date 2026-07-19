import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { editor as MonacoEditor } from "monaco-editor";
import { copyToClipboard } from "@/hooks/useToast";

type Editor = MonacoEditor.IStandaloneCodeEditor;

type Position = { x: number; y: number };

type Props = {
  getEditor: () => Editor | null;
  filePath: string;
  children: React.ReactNode;
};

export function EditorContextMenu({ getEditor, filePath, children }: Props) {
  const [pos, setPos] = useState<Position | null>(null);

  return (
    <div
      className="h-full w-full"
      onContextMenu={(e) => {
        const ed = getEditor();
        if (!ed) return;
        e.preventDefault();
        // Move o cursor pra posição do clique para que getAction().isSupported()
        // reflita o contexto correto (símbolo embaixo do mouse, etc.).
        const target = ed.getTargetAtClientPoint(e.clientX, e.clientY);
        if (target?.position) {
          ed.setPosition(target.position);
        }
        setPos({ x: e.clientX, y: e.clientY });
      }}
    >
      {children}
      {pos && (
        <Menu pos={pos} editor={getEditor()} filePath={filePath} onClose={() => setPos(null)} />
      )}
    </div>
  );
}

type Item =
  | {
      kind: "action";
      label: string;
      actionId: string;
      requireSelection?: boolean;
    }
  | {
      kind: "custom";
      label: string;
      onSelect: () => void;
      shortcut?: string;
    }
  | { kind: "separator" };

// Configuração canônica do menu (ordem fixa, presença dinâmica).
const ITEMS: Item[] = [
  { kind: "action", label: "Ir para definição", actionId: "editor.action.revealDefinition" },
  { kind: "action", label: "Ir para implementação", actionId: "editor.action.goToImplementation" },
  { kind: "action", label: "Ir para tipo", actionId: "editor.action.goToTypeDefinition" },
  { kind: "action", label: "Localizar referências", actionId: "editor.action.goToReferences" },
  { kind: "action", label: "Ir para símbolo no arquivo…", actionId: "editor.action.quickOutline" },
  { kind: "separator" },
  { kind: "action", label: "Renomear símbolo", actionId: "editor.action.rename" },
  { kind: "action", label: "Refatorar…", actionId: "editor.action.refactor" },
  { kind: "action", label: "Ações rápidas", actionId: "editor.action.quickFix" },
  { kind: "action", label: "Mudar todas as ocorrências", actionId: "editor.action.changeAll" },
  { kind: "separator" },
  {
    kind: "action",
    label: "Recortar",
    actionId: "editor.action.clipboardCutAction",
    requireSelection: true,
  },
  {
    kind: "action",
    label: "Copiar",
    actionId: "editor.action.clipboardCopyAction",
    requireSelection: true,
  },
  { kind: "action", label: "Colar", actionId: "editor.action.clipboardPasteAction" },
  { kind: "separator" },
  { kind: "action", label: "Formatar documento", actionId: "editor.action.formatDocument" },
  {
    kind: "action",
    label: "Formatar seleção",
    actionId: "editor.action.formatSelection",
    requireSelection: true,
  },
  { kind: "action", label: "Comentar linha", actionId: "editor.action.commentLine" },
  { kind: "action", label: "Comentar bloco", actionId: "editor.action.blockComment" },
  { kind: "separator" },
  { kind: "custom", label: "Copiar caminho do arquivo", onSelect: () => {} },
  { kind: "custom", label: "Copiar nome do arquivo", onSelect: () => {} },
  { kind: "separator" },
  { kind: "action", label: "Paleta de comandos", actionId: "editor.action.quickCommand" },
];

type ResolvedItem =
  | {
      kind: "item";
      label: string;
      shortcut?: string;
      onSelect: () => void;
    }
  | { kind: "separator" };

// Tenta extrair o keybinding registrado para uma action via API privada do Monaco.
// Cai pra null se não conseguir — o item simplesmente fica sem shortcut.
function lookupShortcut(editor: Editor, actionId: string): string | undefined {
  try {
    const svc = (
      editor as unknown as {
        _standaloneKeybindingService?: {
          lookupKeybinding: (id: string) => { getLabel: () => string | null } | null;
        };
      }
    )._standaloneKeybindingService;
    const kb = svc?.lookupKeybinding(actionId);
    return kb?.getLabel() ?? undefined;
  } catch {
    return undefined;
  }
}

function resolveItems(editor: Editor, filePath: string, close: () => void): ResolvedItem[] {
  const hasSelection = !editor.getSelection()?.isEmpty();

  const resolved: ResolvedItem[] = [];
  for (const item of ITEMS) {
    if (item.kind === "separator") {
      resolved.push({ kind: "separator" });
      continue;
    }

    if (item.kind === "custom") {
      const onSelect =
        item.label === "Copiar caminho do arquivo"
          ? async () => {
              await copyToClipboard(filePath, filePath);
              close();
            }
          : async () => {
              const name = filePath.split("/").pop() ?? filePath;
              await copyToClipboard(name, name);
              close();
            };
      resolved.push({ kind: "item", label: item.label, onSelect });
      continue;
    }

    const action = editor.getAction(item.actionId);
    if (!action) continue;
    if (!action.isSupported()) continue;
    if (item.requireSelection && !hasSelection) continue;

    resolved.push({
      kind: "item",
      label: item.label,
      shortcut: lookupShortcut(editor, item.actionId),
      onSelect: () => {
        editor.focus();
        void action.run();
        close();
      },
    });
  }

  // Colapsa separadores órfãos: nunca em primeiro/último, nunca consecutivos.
  const cleaned: ResolvedItem[] = [];
  for (const r of resolved) {
    if (r.kind === "separator") {
      if (cleaned.length === 0) continue;
      const prev = cleaned[cleaned.length - 1];
      if (prev?.kind === "separator") continue;
    }
    cleaned.push(r);
  }
  while (cleaned.length > 0 && cleaned[cleaned.length - 1]?.kind === "separator") {
    cleaned.pop();
  }

  return cleaned;
}

type MenuProps = {
  pos: Position;
  editor: Editor | null;
  filePath: string;
  onClose: () => void;
};

function Menu({ pos, editor, filePath, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<Position>(pos);

  const items = useMemo(
    () => (editor ? resolveItems(editor, filePath, onClose) : []),
    [editor, filePath, onClose],
  );

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

  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[260px] py-1 rounded-md border bg-popover text-popover-foreground shadow-lg outline-none animate-in fade-in-0 zoom-in-95 duration-100"
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
            onClick={item.onSelect}
            className="w-full flex items-center justify-between gap-6 px-3 py-1.5 text-sm text-left outline-none transition-colors cursor-pointer hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
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
