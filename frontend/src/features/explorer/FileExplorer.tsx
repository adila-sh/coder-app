import { SymbolIcon } from "@/components/SymbolIcon";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useConfigs } from "@/hooks/useConfigs";
import { useWorkspaceConfig } from "@/hooks/useWorkspaceConfig";
import { sortEntries } from "./sortEntries";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronRight,
  ClipboardPaste,
  Clock,
  Eye,
  EyeOff,
  FilePlus2,
  FolderPlus,
  Pencil,
  Search,
  Star,
  StarOff,
  Trash2,
  X,
} from "lucide-react";
import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CreateDir,
  CreateFile,
  DeleteEntry,
  ListDir,
  RenameEntry,
  SearchFiles,
} from "../../../wailsjs/go/main/App";
import { toast } from "@/hooks/useToast";
import { dropIntoDir, pasteClipboardIntoDir } from "./pasteFromClipboard";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface Bookmark {
  path: string;
  name: string;
  isDir: boolean;
}

type SortMode = "name-asc" | "name-desc" | "recent";
type CreateMode = "file" | "dir" | null;

interface ContextMenuState {
  entry: FileEntry;
  x: number;
  y: number;
}

interface ExplorerCtx {
  // Apenas callbacks e bookmarks (estáveis ou raramente atualizados).
  // Estado de alta frequência (renameValue/createName) e por-linha
  // (isRenaming/isBookmarked/expanded/loading) chega via props para que
  // memo(FileRow) consiga curto-circuitar re-renders.
  onRenameValueChange: (v: string) => void;
  onRenameStart: (path: string, name: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  bookmarks: Bookmark[];
  onToggleBookmark: (entry: FileEntry) => void;
  onContextMenu: (entry: FileEntry, e: React.MouseEvent) => void;
  onCreateNameChange: (v: string) => void;
  onCreateCommit: () => void;
  onCreateCancel: () => void;
  onOpenFile: (entry: FileEntry) => void;
  onRefresh: () => void;
  onToggleExpand: (entry: FileEntry) => void;
  onExternalDragOver: (entry: FileEntry, e: React.DragEvent) => void;
  onExternalDrop: (entry: FileEntry, e: React.DragEvent) => void;
  ultraFast: boolean;
}

const ExplorerContext = createContext<ExplorerCtx | null>(null);
const useExplorer = () => useContext(ExplorerContext)!;

const BOOKMARKS_KEY = "adila:bookmarks";

// Pastas/arquivos sempre escondidos (não aparecem nem com toggle ativo).
// `.adila` guarda settings/bookmarks/etc. — o sistema lê, mas o usuário
// não precisa ver no explorer.
const ALWAYS_HIDDEN_NAMES = new Set([".adila"]);

// Default estável pra useWorkspaceConfig (evita loop ~100Hz por nova ref).
const EMPTY_HIDDEN: string[] = [];

// ── CreateInput ───────────────────────────────────────────────────────────────

interface CreateInputProps {
  depth: number;
  createName: string;
  createMode: CreateMode;
}

const CreateInput = memo(function CreateInput({ depth, createName, createMode }: CreateInputProps) {
  const ctx = useExplorer();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="flex items-center gap-2 py-1.5" style={{ paddingLeft: `${depth * 14 + 4}px` }}>
      <span className="size-4 shrink-0" />
      {!ctx.ultraFast && (
        <SymbolIcon
          name={createName || (createMode === "dir" ? "folder" : "file")}
          isDir={createMode === "dir"}
          className="size-4 shrink-0"
        />
      )}
      <input
        ref={ref}
        value={createName}
        onChange={(e) => ctx.onCreateNameChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") ctx.onCreateCommit();
          if (e.key === "Escape") ctx.onCreateCancel();
        }}
        placeholder={createMode === "dir" ? "nova-pasta" : "novo-arquivo.txt"}
        className="flex-1 min-w-0 bg-transparent border-0 border-b border-transparent focus:border-ring px-0.5 py-0 text-sm leading-tight outline-none placeholder:text-muted-foreground/40 transition-colors"
      />
    </div>
  );
});

// ── FileRow ───────────────────────────────────────────────────────────────────

interface FileRowProps {
  entry: FileEntry;
  depth: number;
  isRenaming: boolean;
  renameValue: string;
  isBookmarked: boolean;
  expanded: boolean;
  loadingChildren: boolean;
  isDropTarget: boolean;
  dimmed: boolean;
}

const FileRow = memo(function FileRow({
  entry,
  depth,
  isRenaming,
  renameValue,
  isBookmarked,
  expanded,
  loadingChildren,
  isDropTarget,
  dimmed,
}: FileRowProps) {
  const ctx = useExplorer();
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [isRenaming]);

  const handleClick = () => {
    if (isRenaming) return;
    if (!entry.isDir) {
      ctx.onOpenFile(entry);
      return;
    }
    ctx.onToggleExpand(entry);
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-2 hover:bg-accent/60 text-sm py-1.5 cursor-pointer rounded select-none transition-colors h-full",
        isRenaming && "bg-accent",
        isDropTarget && "bg-primary/10 ring-1 ring-inset ring-primary/40",
        dimmed && "opacity-50",
      )}
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
      draggable={!entry.isDir && !isRenaming}
      onDragStart={(e) => {
        if (entry.isDir || isRenaming) return;
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/x-adila-file",
          JSON.stringify({ path: entry.path, name: entry.name }),
        );
      }}
      onDragOver={(e) => ctx.onExternalDragOver(entry, e)}
      onDrop={(e) => ctx.onExternalDrop(entry, e)}
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        ctx.onContextMenu(entry, e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        ctx.onRenameStart(entry.path, entry.name);
      }}
    >
      <span className="size-4 shrink-0 flex items-center justify-center">
        {entry.isDir && (
          <ChevronRight
            className={cn("size-3.5 transition-transform duration-150", expanded && "rotate-90")}
          />
        )}
      </span>

      {!ctx.ultraFast && (
        <SymbolIcon name={entry.name} isDir={entry.isDir} className="size-4 shrink-0" />
      )}

      {isRenaming ? (
        <input
          ref={renameRef}
          value={renameValue}
          onChange={(e) => ctx.onRenameValueChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") ctx.onRenameCommit();
            if (e.key === "Escape") ctx.onRenameCancel();
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-transparent border-0 border-b border-transparent focus:border-ring px-0.5 py-0 text-sm leading-tight outline-none transition-colors"
        />
      ) : (
        <span className="flex-1 truncate text-sm">{entry.name}</span>
      )}

      {isBookmarked && !ctx.ultraFast && (
        <Star className="size-3 shrink-0 mr-1.5 fill-current text-foreground/30" />
      )}
      {loadingChildren && <Spinner size="xs" className="shrink-0 text-muted-foreground" />}
    </div>
  );
});

// ── Tree flattening ──────────────────────────────────────────────────────────

type FlatRow =
  | { kind: "entry"; entry: FileEntry; depth: number; dimmed: boolean }
  | { kind: "create"; depth: number };

function flattenTree(
  rootEntries: FileEntry[],
  expanded: Set<string>,
  childrenByPath: Map<string, FileEntry[]>,
  sort: SortMode,
  recentPaths: string[],
  createParentPath: string | null,
  createActive: boolean,
  rootPath: string,
  hiddenPaths: Set<string>,
  showHidden: boolean,
): FlatRow[] {
  const out: FlatRow[] = [];

  if (createActive && createParentPath === rootPath) {
    out.push({ kind: "create", depth: 0 });
  }

  const isHidden = (entry: FileEntry) =>
    ALWAYS_HIDDEN_NAMES.has(entry.name) || hiddenPaths.has(entry.path);

  const visit = (entries: FileEntry[], depth: number) => {
    const sorted = sortEntries(entries, sort, recentPaths);
    for (const entry of sorted) {
      const hidden = isHidden(entry);
      if (hidden && !showHidden) continue;
      out.push({ kind: "entry", entry, depth, dimmed: hidden });
      if (entry.isDir && expanded.has(entry.path)) {
        if (createActive && createParentPath === entry.path) {
          out.push({ kind: "create", depth: depth + 1 });
        }
        const children = childrenByPath.get(entry.path);
        if (children) visit(children, depth + 1);
      }
    }
  };

  visit(rootEntries, 0);
  return out;
}

// ── SearchResultRow ───────────────────────────────────────────────────────────

const SearchResultRow = memo(function SearchResultRow({
  entry,
  rootPath,
}: {
  entry: FileEntry;
  rootPath: string;
}) {
  const ctx = useExplorer();
  const rel = entry.path.startsWith(rootPath + "/")
    ? entry.path.slice(rootPath.length + 1)
    : entry.path;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!entry.isDir}
      onDragStart={(e) => {
        if (entry.isDir) return;
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/x-adila-file",
          JSON.stringify({ path: entry.path, name: entry.name }),
        );
      }}
      onClick={() => !entry.isDir && ctx.onOpenFile(entry)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !entry.isDir) {
          e.preventDefault();
          ctx.onOpenFile(entry);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        ctx.onContextMenu(entry, e);
      }}
      className="flex w-full items-center gap-1.5 px-2 py-1 text-xs hover:bg-accent/60 text-left cursor-pointer select-none"
    >
      {!ctx.ultraFast && (
        <SymbolIcon name={entry.name} isDir={entry.isDir} className="size-3.5 shrink-0" />
      )}
      <span className="flex-1 truncate">{rel}</span>
    </div>
  );
});

// ── BookmarksSection ──────────────────────────────────────────────────────────

function BookmarksSection() {
  const ctx = useExplorer();
  const [open, setOpen] = useState(true);

  if (ctx.bookmarks.length === 0) return null;

  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wide"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-90")}
        />
        <Star className="size-3 text-amber-400/70" />
        <span className="flex-1 text-left">Favoritos</span>
        <span className="tabular-nums">{ctx.bookmarks.length}</span>
      </button>
      {open && (
        <div className="px-1 pb-1">
          {ctx.bookmarks.map((b) => (
            <div
              key={b.path}
              onClick={() =>
                !b.isDir && ctx.onOpenFile({ name: b.name, path: b.path, isDir: b.isDir })
              }
              onContextMenu={(e) => {
                e.preventDefault();
                ctx.onContextMenu({ name: b.name, path: b.path, isDir: b.isDir }, e);
              }}
              className="group flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/60 rounded cursor-pointer select-none transition-colors"
            >
              <Star className="size-3 shrink-0 text-amber-400/70" />
              <span className="flex-1 truncate">{b.name}</span>
              <button
                type="button"
                title="Remover favorito"
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.onToggleBookmark({ name: b.name, path: b.path, isDir: b.isDir });
                }}
                className="hidden group-hover:flex rounded p-0.5 text-muted-foreground hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mx-2 mb-1 border-t border-border/40" />
    </div>
  );
}

// ── ContextMenuPopup ──────────────────────────────────────────────────────────

interface ContextMenuPopupProps {
  state: ContextMenuState;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onBookmark: () => void;
  isBookmarked: boolean;
  onToggleHide: () => void;
  isHidden: boolean;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onPaste?: () => void;
}

const ContextMenuPopup = forwardRef<HTMLDivElement, ContextMenuPopupProps>(
  (
    {
      state,
      onRename,
      onDelete,
      onBookmark,
      isBookmarked,
      onToggleHide,
      isHidden,
      onNewFile,
      onNewFolder,
      onPaste,
    },
    ref,
  ) => {
    const item =
      "flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left rounded-sm";

    return (
      <div
        ref={ref}
        style={{ position: "fixed", top: state.y, left: state.x, zIndex: 9999 }}
        className="min-w-44 rounded-md border border-border/60 bg-popover shadow-lg py-1 text-foreground"
      >
        {(onNewFile || onNewFolder || onPaste) && (
          <>
            {onNewFile && (
              <button type="button" className={item} onClick={onNewFile}>
                <FilePlus2 className="size-3.5 shrink-0" />
                Novo arquivo aqui
              </button>
            )}
            {onNewFolder && (
              <button type="button" className={item} onClick={onNewFolder}>
                <FolderPlus className="size-3.5 shrink-0" />
                Nova pasta aqui
              </button>
            )}
            {onPaste && (
              <button type="button" className={item} onClick={onPaste}>
                <ClipboardPaste className="size-3.5 shrink-0" />
                Colar do clipboard
              </button>
            )}
            <div className="my-1 border-t border-border/40" />
          </>
        )}
        <button type="button" className={item} onClick={onRename}>
          <Pencil className="size-3.5 shrink-0" />
          Renomear
        </button>
        <button type="button" className={item} onClick={onBookmark}>
          {isBookmarked ? (
            <>
              <StarOff className="size-3.5 shrink-0" />
              Remover favorito
            </>
          ) : (
            <>
              <Star className="size-3.5 shrink-0" />
              Adicionar favorito
            </>
          )}
        </button>
        <button type="button" className={item} onClick={onToggleHide}>
          {isHidden ? (
            <>
              <Eye className="size-3.5 shrink-0" />
              Mostrar
            </>
          ) : (
            <>
              <EyeOff className="size-3.5 shrink-0" />
              Esconder
            </>
          )}
        </button>
        <div className="my-1 border-t border-border/40" />
        <button type="button" className={cn(item, "text-destructive")} onClick={onDelete}>
          <Trash2 className="size-3.5 shrink-0" />
          Excluir
        </button>
      </div>
    );
  },
);

// ── FileExplorer (root) ───────────────────────────────────────────────────────

export interface FileExplorerProps {
  rootPath: string;
  rootEntries: FileEntry[];
  onOpenFile: (entry: FileEntry) => void;
  onRefresh: () => void;
  recentPaths?: string[];
}

export function FileExplorer({
  rootPath,
  rootEntries,
  onOpenFile,
  onRefresh,
  recentPaths = [],
}: FileExplorerProps) {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const { values: explorerCfg, set: setExplorerCfg } = useConfigs({
    "explorer.sortOrder": "name-asc" as SortMode,
    "explorer.confirmDelete": true,
    "performance.ultraFast": false,
  });
  const sort = explorerCfg["explorer.sortOrder"];
  const confirmDelete = explorerCfg["explorer.confirmDelete"];
  const ultraFast = explorerCfg["performance.ultraFast"];
  const { value: hiddenPathsList, set: setHiddenPathsList } = useWorkspaceConfig<string[]>(
    "explorer.hiddenPaths",
    EMPTY_HIDDEN,
  );
  const hiddenPaths = useMemo(() => new Set(hiddenPathsList), [hiddenPathsList]);
  const [showHidden, setShowHidden] = useState(false);
  const toggleHide = useCallback(
    (path: string) => {
      const next = hiddenPaths.has(path)
        ? hiddenPathsList.filter((p) => p !== path)
        : [...hiddenPathsList, path];
      void setHiddenPathsList(next);
    },
    [hiddenPaths, hiddenPathsList, setHiddenPathsList],
  );
  const setSort = useCallback(
    (v: SortMode) => setExplorerCfg("explorer.sortOrder", v),
    [setExplorerCfg],
  );
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() =>
    JSON.parse(localStorage.getItem(BOOKMARKS_KEY) ?? "[]"),
  );
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [childrenByPath, setChildrenByPath] = useState<Map<string, FileEntry[]>>(() => new Map());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set());
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const searchScrollRef = useRef<HTMLDivElement>(null);

  const loadChildrenFor = useCallback(async (path: string) => {
    setLoadingPaths((s) => {
      const n = new Set(s);
      n.add(path);
      return n;
    });
    try {
      const r = await ListDir(path);
      setChildrenByPath((m) => {
        const n = new Map(m);
        n.set(path, (r as FileEntry[]) || []);
        return n;
      });
    } catch {
      setChildrenByPath((m) => {
        const n = new Map(m);
        n.set(path, []);
        return n;
      });
    } finally {
      setLoadingPaths((s) => {
        const n = new Set(s);
        n.delete(path);
        return n;
      });
    }
  }, []);

  const onToggleExpand = useCallback(
    (entry: FileEntry) => {
      if (!entry.isDir) return;
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
          if (!childrenByPath.has(entry.path) && !loadingPaths.has(entry.path)) {
            void loadChildrenFor(entry.path);
          }
        }
        return next;
      });
    },
    [childrenByPath, loadingPaths, loadChildrenFor],
  );

  // auto-expand the create target so the input is visible
  useEffect(() => {
    if (!createParentPath || createMode === null) return;
    if (createParentPath === rootPath) return;
    setExpandedPaths((prev) => {
      if (prev.has(createParentPath)) return prev;
      const next = new Set(prev);
      next.add(createParentPath);
      return next;
    });
    if (!childrenByPath.has(createParentPath) && !loadingPaths.has(createParentPath)) {
      void loadChildrenFor(createParentPath);
    }
  }, [createParentPath, createMode, rootPath, childrenByPath, loadingPaths, loadChildrenFor]);

  // close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (!ctxMenuRef.current?.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  // search debounce
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim() || !rootPath) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await SearchFiles(rootPath, search.trim());
        setSearchResults((r as FileEntry[]) || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 280);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search, rootPath]);

  const saveBookmarks = useCallback((next: Bookmark[]) => {
    setBookmarks(next);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
  }, []);

  const onToggleBookmark = useCallback((entry: FileEntry) => {
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.path === entry.path);
      const next = exists
        ? prev.filter((b) => b.path !== entry.path)
        : [...prev, { path: entry.path, name: entry.name, isDir: entry.isDir }];
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const onRenameStart = useCallback((path: string, name: string) => {
    setRenamingPath(path);
    setRenameValue(name);
    setContextMenu(null);
  }, []);

  const onRenameCommit = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null);
      return;
    }
    const sep = renamingPath.includes("/") ? "/" : "\\";
    const lastSep = Math.max(renamingPath.lastIndexOf("/"), renamingPath.lastIndexOf("\\"));
    const dir = lastSep >= 0 ? renamingPath.slice(0, lastSep) : "";
    const newPath = dir ? `${dir}${sep}${renameValue.trim()}` : renameValue.trim();
    setRenamingPath(null);
    if (newPath !== renamingPath) {
      try {
        await RenameEntry(renamingPath, newPath);
        onRefresh();
      } catch (e) {
        console.error(e);
      }
    }
  }, [renamingPath, renameValue, onRefresh]);

  const onRenameCancel = useCallback(() => setRenamingPath(null), []);

  const onContextMenu = useCallback((entry: FileEntry, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ entry, x: e.clientX, y: e.clientY });
  }, []);

  const startCreate = useCallback((mode: CreateMode, parentPath: string) => {
    setCreateMode(mode);
    setCreateParentPath(parentPath);
    setCreateName("");
    setContextMenu(null);
  }, []);

  const onCreateCommit = useCallback(async () => {
    if (!createName.trim() || !createMode || !createParentPath) return;
    const target = `${createParentPath}/${createName.trim()}`;
    setCreateMode(null);
    setCreateName("");
    try {
      if (createMode === "file") {
        await CreateFile(target);
      } else {
        await CreateDir(target);
      }
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  }, [createName, createMode, createParentPath, onRefresh]);

  const onCreateCancel = useCallback(() => {
    setCreateMode(null);
    setCreateName("");
  }, []);

  const onDelete = useCallback(
    async (path: string) => {
      setContextMenu(null);
      if (confirmDelete) {
        const name = path.split("/").pop() || path;
        if (!window.confirm(`Apagar "${name}"?`)) return;
      }
      try {
        await DeleteEntry(path);
        onRefresh();
      } catch (e) {
        console.error(e);
      }
    },
    [onRefresh, confirmDelete],
  );

  const targetDirFor = useCallback(
    (entry: FileEntry): string => {
      if (entry.isDir) return entry.path;
      const sep = Math.max(entry.path.lastIndexOf("/"), entry.path.lastIndexOf("\\"));
      return sep > 0 ? entry.path.slice(0, sep) : rootPath;
    },
    [rootPath],
  );

  const onPaste = useCallback(
    async (entry: FileEntry) => {
      setContextMenu(null);
      const targetDir = targetDirFor(entry);
      if (!targetDir) {
        toast.error("Pasta de destino inválida");
        return;
      }
      const result = await pasteClipboardIntoDir(targetDir);
      if (result.kind === "ok") {
        const n = result.written.length;
        toast.success(
          n === 1
            ? `Arquivo colado: ${result.written[0].path.split("/").pop()}`
            : `${n} arquivos colados em ${targetDir}`,
        );
        onRefresh();
      } else if (result.kind === "empty") {
        toast.show("Nenhum arquivo para colar no clipboard.");
      } else {
        toast.error("Não foi possível colar", result.message);
      }
    },
    [onRefresh, targetDirFor],
  );

  const isExternalDrag = useCallback((e: React.DragEvent): boolean => {
    const types = Array.from(e.dataTransfer.types ?? []);
    if (types.includes("application/x-adila-file")) return false;
    return (
      types.includes("Files") || types.includes("text/uri-list") || types.includes("text/plain")
    );
  }, []);

  const onExternalDragOver = useCallback(
    (entry: FileEntry, e: React.DragEvent) => {
      if (!isExternalDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      const target = targetDirFor(entry);
      if (target !== dropTargetPath) setDropTargetPath(target);
    },
    [isExternalDrag, targetDirFor, dropTargetPath],
  );

  const onExternalDrop = useCallback(
    async (entry: FileEntry, e: React.DragEvent) => {
      if (!isExternalDrag(e)) return;
      e.preventDefault();
      setDropTargetPath(null);
      const targetDir = targetDirFor(entry);
      const result = await dropIntoDir(e.dataTransfer, targetDir);
      if (result.kind === "ok") {
        const n = result.written.length;
        toast.success(
          n === 1
            ? `Arquivo salvo: ${result.written[0].path.split("/").pop()}`
            : `${n} arquivos salvos em ${targetDir}`,
        );
        onRefresh();
      } else if (result.kind === "error") {
        toast.error("Não foi possível salvar", result.message);
      }
    },
    [isExternalDrag, targetDirFor, onRefresh],
  );

  const onRootDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!isExternalDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (dropTargetPath !== rootPath) setDropTargetPath(rootPath);
    },
    [isExternalDrag, dropTargetPath, rootPath],
  );

  const onRootDragLeave = useCallback((e: React.DragEvent) => {
    // Só limpa se realmente saiu da área (não só passou para um filho).
    if (e.currentTarget === e.target) setDropTargetPath(null);
  }, []);

  const onRootDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!isExternalDrag(e)) return;
      e.preventDefault();
      setDropTargetPath(null);
      const result = await dropIntoDir(e.dataTransfer, rootPath);
      if (result.kind === "ok") {
        const n = result.written.length;
        toast.success(
          n === 1
            ? `Arquivo salvo: ${result.written[0].path.split("/").pop()}`
            : `${n} arquivos salvos em ${rootPath}`,
        );
        onRefresh();
      } else if (result.kind === "error") {
        toast.error("Não foi possível salvar", result.message);
      }
    },
    [isExternalDrag, rootPath, onRefresh],
  );

  const cycleSortMode = () => {
    const next: SortMode =
      sort === "name-asc" ? "name-desc" : sort === "name-desc" ? "recent" : "name-asc";
    void setSort(next);
  };

  const SortIcon = sort === "name-asc" ? ArrowUpAZ : sort === "name-desc" ? ArrowDownAZ : Clock;
  const sortLabel = sort === "name-asc" ? "A→Z" : sort === "name-desc" ? "Z→A" : "Recentes";

  const flatRows = useMemo(
    () =>
      flattenTree(
        rootEntries,
        expandedPaths,
        childrenByPath,
        sort,
        recentPaths,
        createParentPath,
        createMode !== null,
        rootPath,
        hiddenPaths,
        showHidden,
      ),
    [
      rootEntries,
      expandedPaths,
      childrenByPath,
      sort,
      recentPaths,
      createParentPath,
      createMode,
      rootPath,
      hiddenPaths,
      showHidden,
    ],
  );

  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => treeScrollRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  const searchVirtualizer = useVirtualizer({
    count: searchResults.length,
    getScrollElement: () => searchScrollRef.current,
    estimateSize: () => 26,
    overscan: 12,
  });

  const bookmarksSet = useMemo(() => new Set(bookmarks.map((b) => b.path)), [bookmarks]);

  const ctx = useMemo<ExplorerCtx>(
    () => ({
      onRenameValueChange: setRenameValue,
      onRenameStart,
      onRenameCommit,
      onRenameCancel,
      bookmarks,
      onToggleBookmark,
      onContextMenu,
      onCreateNameChange: setCreateName,
      onCreateCommit,
      onCreateCancel,
      onOpenFile,
      onRefresh,
      onToggleExpand,
      onExternalDragOver,
      onExternalDrop,
      ultraFast,
    }),
    [
      onRenameStart,
      onRenameCommit,
      onRenameCancel,
      bookmarks,
      onToggleBookmark,
      onContextMenu,
      onCreateCommit,
      onCreateCancel,
      onOpenFile,
      onRefresh,
      onToggleExpand,
      onExternalDragOver,
      onExternalDrop,
      ultraFast,
    ],
  );

  // suppress unused warning
  void saveBookmarks;

  return (
    <ExplorerContext.Provider value={ctx}>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-1 border-b px-1.5 py-1 shrink-0">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar…"
              aria-label="Buscar arquivos"
              className="h-7 text-xs pl-6 pr-6"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:text-foreground hover:bg-accent"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <div className="h-4 w-px bg-border/60 mx-0.5" />
          <button
            type="button"
            title="Novo arquivo"
            onClick={() => rootPath && startCreate("file", rootPath)}
            disabled={!rootPath}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30"
          >
            <FilePlus2 className="size-3.5" />
          </button>
          <button
            type="button"
            title="Nova pasta"
            onClick={() => rootPath && startCreate("dir", rootPath)}
            disabled={!rootPath}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30"
          >
            <FolderPlus className="size-3.5" />
          </button>
          <button
            type="button"
            title={`Ordenar: ${sortLabel}`}
            onClick={cycleSortMode}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <SortIcon className="size-3.5" />
          </button>
          <button
            type="button"
            title={showHidden ? "Esconder arquivos ocultos" : "Mostrar arquivos ocultos"}
            onClick={() => setShowHidden((v) => !v)}
            className={cn(
              "rounded p-1 hover:bg-accent",
              showHidden ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {showHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
        </div>

        {/* Tree / search results */}
        {!rootPath ? (
          <div className="flex-1 overflow-y-auto scrollbar py-1">
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Use "Abrir pasta" para começar.
            </p>
          </div>
        ) : search ? (
          <div ref={searchScrollRef} className="flex-1 overflow-y-auto scrollbar py-1">
            {searchLoading ? (
              <div className="flex justify-center py-6">
                <Spinner size="md" className="text-muted-foreground" />
              </div>
            ) : searchResults.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum resultado.</p>
            ) : (
              <div
                style={{
                  height: searchVirtualizer.getTotalSize(),
                  width: "100%",
                  position: "relative",
                }}
              >
                {searchVirtualizer.getVirtualItems().map((vRow) => {
                  const entry = searchResults[vRow.index];
                  return (
                    <div
                      key={entry.path}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: vRow.size,
                        transform: `translateY(${vRow.start}px)`,
                      }}
                    >
                      <SearchResultRow entry={entry} rootPath={rootPath} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div
            ref={treeScrollRef}
            onDragOver={onRootDragOver}
            onDragLeave={onRootDragLeave}
            onDrop={onRootDrop}
            className={cn(
              "flex-1 overflow-y-auto scrollbar py-1 transition-colors",
              dropTargetPath === rootPath && "bg-primary/5 ring-1 ring-inset ring-primary/30",
            )}
          >
            <BookmarksSection />

            <div
              style={{
                height: rowVirtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const row = flatRows[vRow.index];
                return (
                  <div
                    key={row.kind === "entry" ? row.entry.path : `create-${row.depth}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: vRow.size,
                      transform: `translateY(${vRow.start}px)`,
                    }}
                  >
                    {row.kind === "create" ? (
                      <CreateInput
                        depth={row.depth}
                        createName={createName}
                        createMode={createMode}
                      />
                    ) : (
                      <FileRow
                        entry={row.entry}
                        depth={row.depth}
                        isRenaming={renamingPath === row.entry.path}
                        renameValue={renamingPath === row.entry.path ? renameValue : ""}
                        isBookmarked={bookmarksSet.has(row.entry.path)}
                        expanded={row.entry.isDir && expandedPaths.has(row.entry.path)}
                        loadingChildren={loadingPaths.has(row.entry.path)}
                        isDropTarget={
                          dropTargetPath !== null &&
                          (row.entry.isDir
                            ? dropTargetPath === row.entry.path
                            : dropTargetPath === targetDirFor(row.entry))
                        }
                        dimmed={row.dimmed}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenuPopup
          ref={ctxMenuRef}
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={() => onRenameStart(contextMenu.entry.path, contextMenu.entry.name)}
          onDelete={() => onDelete(contextMenu.entry.path)}
          onBookmark={() => onToggleBookmark(contextMenu.entry)}
          isBookmarked={bookmarks.some((b) => b.path === contextMenu.entry.path)}
          onToggleHide={() => {
            toggleHide(contextMenu.entry.path);
            setContextMenu(null);
          }}
          isHidden={hiddenPaths.has(contextMenu.entry.path)}
          onNewFile={
            contextMenu.entry.isDir ? () => startCreate("file", contextMenu.entry.path) : undefined
          }
          onNewFolder={
            contextMenu.entry.isDir ? () => startCreate("dir", contextMenu.entry.path) : undefined
          }
          onPaste={() => void onPaste(contextMenu.entry)}
        />
      )}
    </ExplorerContext.Provider>
  );
}
