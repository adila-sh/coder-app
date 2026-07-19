import { DevProfiler } from "@/components/DevProfiler";
import { ShortcutHud, type ShortcutHint } from "@/components/ShortcutHud";
import { Sidebar } from "@/components/Sidebar";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/toaster";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SpotifyView } from "@/features/spotify/SpotifyView";
import { ActionsView } from "@/features/github-actions/ActionsView";
import { TestsView } from "@/features/tests/TestsView";
import { TasksView } from "@/features/tasks/TasksView";
import { PaneTree, type DraggedFile } from "@/features/editor/PaneTree";
import { ProblemsPanel, type EditorMarker } from "@/features/editor/ProblemsPanel";
import { isWebviewPath, webviewPathFromUrl } from "@/features/editor/WebView";
import {
  closeTabInTree,
  deserializePane,
  emptyLeaf,
  findLeafById,
  findLeafWithPath,
  getAllLeaves,
  getAllOpenPaths,
  openOrMoveTab,
  openTabInLeaf,
  reorderTabsInLeaf,
  serializePane,
  setSplitSize,
  setTabClean,
  updateLeaf,
  updateTabContent,
  type DropSide,
  type PaneId,
  type PaneNode,
} from "@/features/editor/panes";
import { rpc as gitRpc } from "@/features/git/rpc";
import { Overlays } from "@/features/overlays/Overlays";
import { StatusBar } from "@/features/statusbar/StatusBar";
import { TopBar } from "@/features/topbar/TopBar";
import { WelcomePage } from "@/features/welcome/WelcomePage";
import { useConfigs } from "@/hooks/useConfigs";
import { useRecentFolders } from "@/hooks/useRecentFolders";
import { loadSession, saveSession } from "@/hooks/useSession";
import { useTheme } from "@/hooks/useTheme";
import { bootstrapIconTheme } from "@/stores/iconThemeStore";
import { useMarkersStore } from "@/stores/markersStore";
import { useUiStore } from "@/stores/uiStore";

bootstrapIconTheme();
import "@/index.css";
import { X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GetInitialPath,
  ListDir,
  OpenFolderDialog,
  ReadFile,
  WatchRoot,
  WriteFile,
} from "../wailsjs/go/main/App";
import { SetWorkdir as cmdSetWorkdir } from "../wailsjs/go/main/CommandCenter";
import { SetWorkdir as wcfgSetWorkdir } from "../wailsjs/go/main/WorkspaceConfig";
import { SetWorkdir as indexerSetWorkdir } from "../wailsjs/go/main/Indexer";
import { SetWorkdir as testsSetWorkdir } from "../wailsjs/go/main/Tests";
import { tasksRpc } from "@/features/tasks/rpc";
import { EventsEmit, EventsOn } from "../wailsjs/runtime/runtime";

const TerminalPanel = lazy(() =>
  import("@/features/terminal/TerminalPanel").then((m) => ({ default: m.TerminalPanel })),
);
const SettingsView = lazy(() =>
  import("@/features/settings/SettingsView").then((m) => ({ default: m.SettingsView })),
);
const AboutView = lazy(() =>
  import("@/features/about/AboutView").then((m) => ({ default: m.AboutView })),
);
const OnboardingView = lazy(() =>
  import("@/features/onboarding/OnboardingView").then((m) => ({ default: m.OnboardingView })),
);
const GitView = lazy(() => import("@/features/git/GitView").then((m) => ({ default: m.GitView })));
const GitHubProfileView = lazy(() =>
  import("@/features/git/GitHubProfileView").then((m) => ({ default: m.GitHubProfileView })),
);
const KeybindingsView = lazy(() =>
  import("@/features/keybindings/KeybindingsView").then((m) => ({ default: m.KeybindingsView })),
);
const BenchView = lazy(() =>
  import("@/features/bench/BenchView").then((m) => ({ default: m.BenchView })),
);
const LinearView = lazy(() =>
  import("@/features/linear/LinearView").then((m) => ({ default: m.LinearView })),
);
const ThemeEditor = lazy(() =>
  import("@/features/theme-editor/ThemeEditor").then((m) => ({ default: m.ThemeEditor })),
);
const NotificationsView = lazy(() =>
  import("@/features/notifications/components/Center").then((m) => ({
    default: m.NotificationsView,
  })),
);
const MarkdownPreview = lazy(() =>
  import("@/features/editor/MarkdownPreview").then((m) => ({ default: m.MarkdownPreview })),
);
const LivePreview = lazy(() =>
  import("@/features/editor/LivePreview").then((m) => ({ default: m.LivePreview })),
);
const PatchDiff = lazy(() => import("@pierre/diffs/react").then((m) => ({ default: m.PatchDiff })));

function ViewFallback() {
  return (
    <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
      Carregando…
    </div>
  );
}

type Entry = { name: string; path: string; isDir: boolean };
type View =
  | "editor"
  | "settings"
  | "about"
  | "onboarding"
  | "git"
  | "keybindings"
  | "bench"
  | "themeEditor"
  | "notifications"
  | "githubProfile"
  | "spotify"
  | "actions"
  | "tests"
  | "tasks"
  | "linear";
type BottomPanel = "terminal" | "problems" | "diff";

function OverlayHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="flex items-center justify-between border-b border-border/60 px-4 py-2 shrink-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Fechar ${title.toLowerCase()}`}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </header>
  );
}

function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function SettingsOverlay({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col">
      <OverlayHeader title="Configurações" onClose={onClose} />
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<ViewFallback />}>
          <DevProfiler id="SettingsView">
            <SettingsView />
          </DevProfiler>
        </Suspense>
      </div>
    </div>
  );
}

function GitOverlay({ onClose, rootPath }: { onClose: () => void; rootPath: string }) {
  useEscapeToClose(onClose);

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col">
      <OverlayHeader title="Controle de versão" onClose={onClose} />
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<ViewFallback />}>
          <DevProfiler id="GitView">
            <GitView rootPath={rootPath} />
          </DevProfiler>
        </Suspense>
      </div>
    </div>
  );
}

// Lê counts isolados — não rerenderiza o resto da tab bar quando markers mudam.
function ProblemsTabCounts() {
  const errorCount = useMarkersStore((s) => s.errorCount);
  const warningCount = useMarkersStore((s) => s.warningCount);
  return (
    <>
      {errorCount > 0 && <span className="text-destructive">{errorCount}</span>}
      {warningCount > 0 && <span className="text-amber-500">{warningCount}</span>}
    </>
  );
}

function NotificationsOverlay({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col">
      <OverlayHeader title="Notificações" onClose={onClose} />
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<ViewFallback />}>
          <DevProfiler id="NotificationsView">
            <NotificationsView />
          </DevProfiler>
        </Suspense>
      </div>
    </div>
  );
}

function App() {
  const [rootPath, setRootPath] = useState<string>("");
  const [rootEntries, setRootEntries] = useState<Entry[]>([]);
  const [rootPane, setRootPane] = useState<PaneNode>(() => emptyLeaf());
  const [focusedPaneId, setFocusedPaneId] = useState<PaneId>(() => (rootPane as { id: PaneId }).id);
  const [bottomPanel, setBottomPanel] = useState<BottomPanel | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  // overlays vivem em useUiStore — palette/themePicker/quickOpen/notifications
  // são renderizados isolados em <Overlays />, cada um assinando o próprio
  // flag. App só precisa de markdownPreviewOpen pra layout do editor.
  const markdownPreviewOpen = useUiStore((s) => s.markdownPreviewOpen);
  const livePreviewOpen = useUiStore((s) => s.livePreviewOpen);
  const [view, setView] = useState<View>("editor");
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  // cursorPos, branch e markers vivem em stores — alta frequência de update +
  // leitura por componentes específicos (StatusBar, ProblemsPanel). Manter em
  // useState aqui re-renderizava todo o App a cada keystroke do LSP.
  const [diffPatch, setDiffPatch] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [pendingClose, setPendingClose] = useState<{ paneId: PaneId; path: string } | null>(null);

  const { values: bootCfg, set: setBootCfg } = useConfigs({
    "workbench.sideBar.location": "left" as "left" | "right",
    "workbench.zenMode": false,
    "workbench.shortcutHud": true,
    "developer.showFps": false,
    "editor.autoSave": "off",
    "editor.autoSaveDelay": 1000,
    "window.zoomLevel": 0,
  });
  const sidebarLocation = bootCfg["workbench.sideBar.location"];
  const zenMode = bootCfg["workbench.zenMode"];
  const shortcutHudEnabled = bootCfg["workbench.shortcutHud"];
  const showFps = bootCfg["developer.showFps"];
  const autoSave = bootCfg["editor.autoSave"];
  const autoSaveDelay = bootCfg["editor.autoSaveDelay"];
  const zoomLevel = bootCfg["window.zoomLevel"];
  const toggleSpotify = useCallback(
    () => setView((v) => (v === "spotify" ? "editor" : "spotify")),
    [],
  );
  const setZenMode = useCallback((v: boolean) => setBootCfg("workbench.zenMode", v), [setBootCfg]);

  useEffect(() => {
    const z = typeof zoomLevel === "number" ? zoomLevel : 0;
    document.documentElement.style.fontSize = `${100 + z * 10}%`;
    return () => {
      document.documentElement.style.fontSize = "";
    };
  }, [zoomLevel]);

  // Zen mode só faz sentido com pasta aberta — desativa no welcome
  // para evitar abrir o app numa tela "vazia" sem topbar/statusbar.
  useEffect(() => {
    if (!rootPath && zenMode) void setZenMode(false);
  }, [rootPath, zenMode, setZenMode]);
  const {
    folders: recentFolders,
    push: pushRecentFolder,
    remove: removeRecentFolder,
  } = useRecentFolders();
  useTheme();
  const [shortcutHint, setShortcutHint] = useState<ShortcutHint | null>(null);
  const hintIdRef = useRef(0);
  const shortcutHudEnabledRef = useRef<boolean>(shortcutHudEnabled !== false);
  useEffect(() => {
    shortcutHudEnabledRef.current = shortcutHudEnabled !== false;
  }, [shortcutHudEnabled]);
  const showHint = useCallback((label: string) => {
    if (!shortcutHudEnabledRef.current) return;
    hintIdRef.current += 1;
    setShortcutHint({ label, id: hintIdRef.current });
  }, []);

  const focusedLeaf = useMemo(
    () => findLeafById(rootPane, focusedPaneId),
    [rootPane, focusedPaneId],
  );
  const activeTab = useMemo(
    () => focusedLeaf?.tabs.find((t) => t.path === focusedLeaf.activePath),
    [focusedLeaf],
  );
  const activePath = activeTab?.path ?? "";
  const openPaths = useMemo(() => getAllOpenPaths(rootPane), [rootPane]);

  // Refs para auto-save sem stale closure
  const rootPaneRef = useRef(rootPane);
  useEffect(() => {
    rootPaneRef.current = rootPane;
  });
  const focusedPaneIdRef = useRef(focusedPaneId);
  useEffect(() => {
    focusedPaneIdRef.current = focusedPaneId;
  }, [focusedPaneId]);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    useUiStore.getState().resetCursor();
  }, [activePath]);

  // Restaura sessão salva ao iniciar — CLI path tem prioridade sobre sessão.
  // Dispara CLI + session em paralelo (1 round-trip IPC só) e depois paraleliza
  // o ListDir do root com a deserialização das tabs salvas.
  useEffect(() => {
    void (async () => {
      const [cliPath, session] = await Promise.all([
        GetInitialPath().catch(() => ""),
        loadSession(),
      ]);
      if (cliPath) {
        await openFolderRef.current(cliPath);
        return;
      }
      if (!session?.rootPath) return;

      if (session.paneTree) {
        // ListDir do root e ReadFile das tabs em paralelo: nada bloqueia
        // ninguém — Wails serve essas IPCs concorrentes.
        const [, tree] = await Promise.all([
          openFolderRef.current(session.rootPath),
          deserializePane(session.paneTree, ReadFile),
        ]);
        setRootPane(tree);
        const leaves = getAllLeaves(tree);
        const focusable =
          (session.focusedPaneId && leaves.find((l) => l.id === session.focusedPaneId)) ||
          leaves.find((l) => l.tabs.length > 0) ||
          leaves[0];
        if (focusable) setFocusedPaneId(focusable.id);
        return;
      }

      await openFolderRef.current(session.rootPath);
      // legado: lista plana de arquivos
      for (const filePath of session.openFiles) {
        await openFileRef.current({
          name: filePath.split("/").pop() ?? filePath,
          path: filePath,
          isDir: false,
        });
      }
      if (session.activePath) {
        setRootPane((prev) => {
          const leaf = findLeafWithPath(prev, session.activePath);
          if (!leaf) return prev;
          return updateLeaf(prev, leaf.id, (l) => ({ ...l, activePath: session.activePath }));
        });
      }
    })();
  }, []);

  // Persiste sessão com debounce ao mudar rootPath/rootPane/foco
  useEffect(() => {
    if (!rootPath) return;
    if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current);
    sessionSaveTimerRef.current = setTimeout(() => {
      void saveSession({
        rootPath,
        openFiles: openPaths,
        activePath,
        paneTree: serializePane(rootPane),
        focusedPaneId,
      });
    }, 500);
  }, [rootPath, rootPane, openPaths, activePath, focusedPaneId]);

  useEffect(() => {
    return gitRpc.on("git.branch", (b: unknown) => {
      if (typeof b === "string") useUiStore.getState().setBranch(b);
    });
  }, []);

  const openFolder = async (folderPath?: string) => {
    try {
      const path =
        typeof folderPath === "string" && folderPath ? folderPath : await OpenFolderDialog();
      if (!path) return;
      setRootPath(path);
      gitRpc.git.setWorkdir(path);
      void cmdSetWorkdir(path);
      void tasksRpc.setWorkdir(path);
      void testsSetWorkdir(path);
      void wcfgSetWorkdir(path);
      void indexerSetWorkdir(path);
      const entries = await ListDir(path);
      setRootEntries(entries || []);
      void pushRecentFolder(path);
      void WatchRoot(path);
    } catch (e) {
      console.error(e);
    }
  };

  const trackRecent = useCallback(
    (path: string) =>
      setRecentPaths((prev) => [path, ...prev.filter((p) => p !== path)].slice(0, 30)),
    [],
  );

  const openUrl = (rawUrl: string) => {
    const url = rawUrl.trim();
    if (!url) return;
    const path = webviewPathFromUrl(
      /^https?:\/\//i.test(url)
        ? url
        : /^localhost(:\d+)?(\/|$)/i.test(url) || url.startsWith("127.0.0.1")
          ? `http://${url}`
          : `https://${url}`,
    );
    const existingLeaf = findLeafWithPath(rootPaneRef.current, path);
    if (existingLeaf) {
      setRootPane((prev) => updateLeaf(prev, existingLeaf.id, (l) => ({ ...l, activePath: path })));
      setFocusedPaneId(existingLeaf.id);
      return;
    }
    const tab = { path, content: "", dirty: false };
    setRootPane((prev) => {
      const targetId = findLeafById(prev, focusedPaneId)
        ? focusedPaneId
        : (prev as { id: PaneId }).id;
      return updateLeaf(prev, targetId, (l) => openTabInLeaf(l, tab));
    });
  };

  const onWebviewNavigate = useCallback((paneId: PaneId, oldPath: string, newPath: string) => {
    if (oldPath === newPath) return;
    setRootPane((prev) =>
      updateLeaf(prev, paneId, (l) => {
        const idx = l.tabs.findIndex((t) => t.path === oldPath);
        if (idx === -1) return l;
        // se já há outra tab com o newPath neste leaf, apenas foca e remove a antiga
        if (l.tabs.some((t) => t.path === newPath)) {
          return {
            ...l,
            tabs: l.tabs.filter((t) => t.path !== oldPath),
            activePath: newPath,
          };
        }
        const tabs = [...l.tabs];
        tabs[idx] = { ...tabs[idx], path: newPath };
        return {
          ...l,
          tabs,
          activePath: l.activePath === oldPath ? newPath : l.activePath,
        };
      }),
    );
  }, []);

  const openFile = async (entry: Entry) => {
    // se já existe num leaf, apenas foca
    const existingLeaf = findLeafWithPath(rootPaneRef.current, entry.path);
    if (existingLeaf) {
      setRootPane((prev) =>
        updateLeaf(prev, existingLeaf.id, (l) => ({ ...l, activePath: entry.path })),
      );
      setFocusedPaneId(existingLeaf.id);
      trackRecent(entry.path);
      return;
    }
    try {
      const content = await ReadFile(entry.path);
      const tab = { path: entry.path, content, dirty: false };
      setRootPane((prev) => {
        const targetId = findLeafById(prev, focusedPaneId)
          ? focusedPaneId
          : (prev as { id: PaneId }).id; // fallback para root se for leaf
        return updateLeaf(prev, targetId, (l) => openTabInLeaf(l, tab));
      });
      trackRecent(entry.path);
    } catch (e) {
      console.error(e);
    }
  };

  // Atualiza o conteúdo de qualquer arquivo aberto + agenda auto-save
  const updateFile = useCallback(
    (filePath: string, content: string) => {
      setRootPane((prev) => updateTabContent(prev, filePath, content, true));
      if (autoSave === "afterDelay") {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(async () => {
          // pega o conteúdo mais recente da árvore
          const leaf = findLeafWithPath(rootPaneRef.current, filePath);
          const tab = leaf?.tabs.find((t) => t.path === filePath);
          if (!tab?.dirty) return;
          try {
            await WriteFile(filePath, tab.content);
            setRootPane((p) => setTabClean(p, filePath));
          } catch (e) {
            console.error(e);
          }
        }, autoSaveDelay ?? 1000);
      }
    },
    [autoSave, autoSaveDelay],
  );

  const openFileRef = useRef(openFile);
  useEffect(() => {
    openFileRef.current = openFile;
  });
  // Wrapper estável que delega ao ref — props passadas pra Sidebar/PaneTree
  // não mudam de identidade a cada render, permitindo que memo() funcione.
  const stableOpenFile = useCallback((entry: Entry) => openFileRef.current(entry), []);

  const openUrlRef = useRef(openUrl);
  useEffect(() => {
    openUrlRef.current = openUrl;
  });

  const setViewRef = useRef(setView);
  useEffect(() => {
    setViewRef.current = setView;
  });

  const openFolderRef = useRef(openFolder);
  useEffect(() => {
    openFolderRef.current = openFolder;
  });

  const zenModeRef = useRef(zenMode as boolean);
  useEffect(() => {
    zenModeRef.current = zenMode as boolean;
  }, [zenMode]);
  const setZenModeRef = useRef(setZenMode);
  useEffect(() => {
    setZenModeRef.current = setZenMode;
  });
  const chordRef = useRef<string | null>(null);

  const refreshRoot = useCallback(async () => {
    if (!rootPath) return;
    try {
      const entries = await ListDir(rootPath);
      setRootEntries((entries as Entry[]) || []);
    } catch (e) {
      console.error(e);
    }
  }, [rootPath]);

  const refreshRootRef = useRef(refreshRoot);
  const stableRefreshRoot = useCallback(() => refreshRootRef.current(), []);
  const onGotoLine = useCallback((_path: string, line: number, column: number) => {
    setTimeout(() => EventsEmit("editor.gotoLine", { line, column }), 50);
  }, []);
  useEffect(() => {
    refreshRootRef.current = refreshRoot;
  });

  // Evento do file watcher Go → atualiza árvore
  useEffect(() => {
    return EventsOn("fileTree.changed", () => void refreshRootRef.current());
  }, []);

  // Escuta evento do Go: Config.OpenSettingsJson() emite "editor.openFile".
  useEffect(() => {
    return EventsOn("editor.openFile", (path: unknown) => {
      if (typeof path !== "string") return;
      openFileRef.current({ name: path.split("/").pop() ?? path, path, isDir: false });
    });
  }, []);

  // Escuta comandos emitidos pelo CommandCenter.Execute() no Go.
  useEffect(() => {
    return EventsOn("commandCenter.exec", (id: unknown) => {
      switch (id) {
        case "openFolder":
          void openFolderRef.current();
          break;
        case "toggleTerminal":
          setBottomPanel((p) => (p === "terminal" ? null : "terminal"));
          break;
        case "openSettings":
          setViewRef.current("settings");
          break;
        case "openKeybindings":
          setViewRef.current("keybindings");
          break;
        case "openGitView":
          setViewRef.current("git");
          break;
        case "openBenchView":
          setViewRef.current("bench");
          break;
        case "openOnboarding":
          setViewRef.current("onboarding");
          break;
        case "openAbout":
          setViewRef.current("about");
          break;
        case "toggleZen":
          void setZenModeRef.current(!zenModeRef.current);
          break;
        case "openThemeEditor":
          setViewRef.current("themeEditor");
          break;
        case "openGitHubProfile":
          setViewRef.current("githubProfile");
          break;
        case "openLinear":
          setViewRef.current("linear");
          break;
        case "openWebview":
          {
            const url = window.prompt(
              "URL para abrir como aba (ex: http://localhost:5173)",
              "http://localhost:5173",
            );
            if (url) openUrlRef.current(url);
          }
          break;
      }
    });
  }, []);

  const doCloseTab = useCallback((paneId: PaneId, path: string) => {
    const result = closeTabInTree(rootPaneRef.current, paneId, path);
    setRootPane(result.root);
    if (result.focusId) setFocusedPaneId(result.focusId);
    useMarkersStore.getState().clearPath(path);
  }, []);

  const onCloseTab = useCallback(
    (paneId: PaneId, path: string) => {
      const leaf = findLeafById(rootPaneRef.current, paneId);
      const tab = leaf?.tabs.find((t) => t.path === path);
      if (tab?.dirty) {
        setPendingClose({ paneId, path });
        return;
      }
      doCloseTab(paneId, path);
    },
    [doCloseTab],
  );

  const onActivateTab = useCallback(
    (paneId: PaneId, path: string) => {
      setRootPane((prev) => updateLeaf(prev, paneId, (l) => ({ ...l, activePath: path })));
      setFocusedPaneId(paneId);
      if (!isWebviewPath(path)) trackRecent(path);
    },
    [trackRecent],
  );

  const onReorderTabs = useCallback((paneId: PaneId, fromIndex: number, toIndex: number) => {
    setRootPane((prev) => reorderTabsInLeaf(prev, paneId, fromIndex, toIndex));
  }, []);

  const onDropFile = useCallback(
    async (paneId: PaneId, side: DropSide, file: DraggedFile) => {
      // no-op: arrastar tab pra ele mesmo no centro
      if (file.fromPaneId && file.fromPaneId === paneId && side === "center") return;

      // se o arquivo já está aberto em algum leaf, reaproveita o tab existente
      const existingLeaf = findLeafWithPath(rootPaneRef.current, file.path);
      let tab = existingLeaf?.tabs.find((t) => t.path === file.path);
      if (!tab) {
        try {
          const content = await ReadFile(file.path);
          tab = { path: file.path, content, dirty: false };
        } catch (e) {
          console.error(e);
          return;
        }
      }
      setRootPane((prev) => {
        const opened = openOrMoveTab(prev, paneId, tab!, side);
        let next = opened.root;
        let focusId = opened.focusId;
        // se veio de outro pane (drag de tab), remove do leaf de origem
        if (file.fromPaneId && file.fromPaneId !== focusId) {
          const closed = closeTabInTree(next, file.fromPaneId, file.path);
          next = closed.root;
          // se o leaf focado virou outro depois do collapse, mantém o do open
          if (!findLeafById(next, focusId) && closed.focusId) focusId = closed.focusId;
        }
        setFocusedPaneId(focusId);
        return next;
      });
      trackRecent(file.path);
    },
    [trackRecent],
  );

  const splitActiveTab = useCallback((side: Exclude<DropSide, "center">) => {
    const focusId = focusedPaneIdRef.current;
    const leaf = findLeafById(rootPaneRef.current, focusId);
    const tab = leaf?.tabs.find((t) => t.path === leaf.activePath);
    if (!leaf || !tab) return;
    setRootPane((prev) => {
      const result = openOrMoveTab(prev, focusId, tab, side);
      setFocusedPaneId(result.focusId);
      return result.root;
    });
  }, []);

  const onSplitRight = useCallback(() => splitActiveTab("right"), [splitActiveTab]);
  const onSplitDown = useCallback(() => splitActiveTab("bottom"), [splitActiveTab]);

  const handleOpenUrl = useCallback(() => {
    const url = window.prompt(
      "URL para abrir como aba (ex: http://localhost:5173)",
      "http://localhost:5173",
    );
    if (url) openUrlRef.current(url);
  }, []);

  const onToggleSidebar = useCallback(() => setSidebarVisible((v) => !v), []);
  const onGotoSymbol = useCallback(() => EventsEmit("editor.gotoSymbol"), []);
  const onOpenQuickFile = useCallback(() => useUiStore.getState().setQuickOpenOpen(true), []);
  const onFindInFiles = useCallback(() => useUiStore.getState().openPalette(""), []);

  const closeActiveTab = useCallback(() => {
    const focusId = focusedPaneIdRef.current;
    const leaf = findLeafById(rootPaneRef.current, focusId);
    if (!leaf || !leaf.activePath) return;
    onCloseTab(focusId, leaf.activePath);
  }, []);

  const focusNthLeaf = useCallback((n: number) => {
    const leaves = getAllLeaves(rootPaneRef.current);
    const target = leaves[n];
    if (target) setFocusedPaneId(target.id);
  }, []);

  const saveActive = useCallback(async () => {
    const path = activePath;
    if (!path || isWebviewPath(path)) return;
    const leaf = findLeafWithPath(rootPaneRef.current, path);
    const tab = leaf?.tabs.find((t) => t.path === path);
    if (!tab) return;
    try {
      await WriteFile(tab.path, tab.content);
      setRootPane((p) => setTabClean(p, path));
    } catch (e) {
      console.error(e);
    }
  }, [activePath]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;

      // Chord: aguardando segunda tecla após Ctrl+K
      if (chordRef.current === "k") {
        chordRef.current = null;
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          showHint("Ctrl + K + Z");
          void setZenMode(!zenModeRef.current);
          return;
        }
        if (e.key.toLowerCase() === "o") {
          e.preventDefault();
          showHint("Ctrl + K + O");
          void openFolderRef.current();
          return;
        }
        if (e.key.toLowerCase() === "t") {
          e.preventDefault();
          showHint("Ctrl + K + T");
          useUiStore.getState().setThemePickerOpen(true);
          return;
        }
        if (e.key === "\\") {
          e.preventDefault();
          showHint("Ctrl + K + \\");
          splitActiveTab("bottom");
          return;
        }
      }

      if (meta && !e.shiftKey && !e.altKey && e.key === "\\") {
        e.preventDefault();
        showHint("Ctrl + \\");
        splitActiveTab("right");
        return;
      }
      if (meta && e.altKey && !e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        showHint("Ctrl + Alt + M");
        toggleSpotify();
        return;
      }
      if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        showHint("Ctrl + W");
        closeActiveTab();
        return;
      }
      if (meta && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        showHint(`Ctrl + ${e.key}`);
        focusNthLeaf(Number(e.key) - 1);
        return;
      }

      if (meta && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        showHint("Ctrl + Shift + O");
        EventsEmit("editor.gotoSymbol");
        return;
      }
      if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        showHint("Ctrl + P");
        useUiStore.getState().setQuickOpenOpen(true);
        return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        showHint("Ctrl + Shift + P");
        useUiStore.getState().openPalette("> ");
        return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        showHint("Ctrl + Shift + M");
        setBottomPanel((p) => (p === "problems" ? null : "problems"));
        return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "u") {
        e.preventDefault();
        showHint("Ctrl + Shift + U");
        const url = window.prompt(
          "URL para abrir como aba (ex: http://localhost:5173)",
          "http://localhost:5173",
        );
        if (url) openUrlRef.current(url);
        return;
      }
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        showHint("Ctrl + S");
        saveActive();
        return;
      }
      if (meta && e.key === "`") {
        e.preventDefault();
        showHint("Ctrl + `");
        setBottomPanel((p) => (p === "terminal" ? null : "terminal"));
        return;
      }
      if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        showHint("Ctrl + J");
        setBottomPanel((p) => (p === "terminal" ? null : "terminal"));
        return;
      }
      if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        showHint("Ctrl + B");
        setSidebarVisible((v) => !v);
        return;
      }
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        showHint("Ctrl + K");
        chordRef.current = "k";
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    saveActive,
    setZenMode,
    showHint,
    splitActiveTab,
    closeActiveTab,
    focusNthLeaf,
    toggleSpotify,
  ]);

  const onMarkersChange = useCallback((filePath: string, fileMarkers: EditorMarker[]) => {
    useMarkersStore.getState().setForPath(filePath, fileMarkers);
  }, []);

  // Vai pro store sem inscrever — não re-renderiza o App a cada movimento de caret.
  const onCursorChange = useCallback((line: number, col: number) => {
    useUiStore.getState().setCursor(line, col);
  }, []);
  const onSplitSizeChange = useCallback((splitId: PaneId, size: number) => {
    setRootPane((prev) => setSplitSize(prev, splitId, size));
  }, []);

  const isMarkdown = /\.(md|mdx)$/i.test(activeTab?.path ?? "");

  // Carrega diff quando o painel de diff abre ou o arquivo ativo muda
  useEffect(() => {
    if (bottomPanel !== "diff" || !activePath) {
      setDiffPatch(null);
      return;
    }
    setDiffLoading(true);
    gitRpc.git
      .diff(activePath, false)
      .then((p: unknown) => setDiffPatch(p as string))
      .catch(() => setDiffPatch(null))
      .finally(() => setDiffLoading(false));
  }, [bottomPanel, activePath]);

  // Painel inferior: terminal + problemas + diff com aba de seleção
  const bottomPanelEl = bottomPanel !== null && (
    <ResizablePanel key="bottom" preferredSize="30%" minSize={120}>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Aba seletora */}
        <div className="flex items-center border-b shrink-0 text-xs bg-muted/20">
          {(["terminal", "problems", "diff"] as BottomPanel[]).map((panel) => (
            <button
              key={panel}
              onClick={() => setBottomPanel(panel)}
              className={
                "px-3 py-1.5 border-b-2 transition-colors flex items-center gap-1.5 " +
                (bottomPanel === panel
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {panel === "terminal" ? (
                "Terminal"
              ) : panel === "diff" ? (
                "Diff"
              ) : (
                <>
                  Problemas
                  <ProblemsTabCounts />
                </>
              )}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => setBottomPanel(null)}
            className="px-2 py-1 text-muted-foreground hover:text-foreground"
            aria-label="Fechar painel"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden min-h-0">
          {/* Terminal: mantido montado para preservar sessão PTY */}
          <div
            style={{
              display: bottomPanel === "terminal" ? "flex" : "none",
              height: "100%",
              flexDirection: "column",
            }}
          >
            <Suspense fallback={<ViewFallback />}>
              <TerminalPanel
                defaultCwd={rootPath || undefined}
                onClose={() => setBottomPanel(null)}
                onFileLink={(path, line) => {
                  openFile({ name: path.split("/").pop() ?? path, path, isDir: false });
                  console.log("link:", path, line);
                }}
              />
            </Suspense>
          </div>

          {bottomPanel === "problems" && (
            <ProblemsPanel
              rootPath={rootPath}
              onNavigate={(path, line, col) => {
                openFile({ name: path.split("/").pop() ?? path, path, isDir: false });
                setTimeout(() => EventsEmit("editor.gotoLine", { line, column: col }), 50);
              }}
            />
          )}

          {bottomPanel === "diff" && (
            <div className="h-full overflow-auto">
              {diffLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Carregando diff…
                </div>
              ) : diffPatch ? (
                <Suspense fallback={<ViewFallback />}>
                  <PatchDiff
                    patch={diffPatch}
                    options={{ diffIndicators: "bars", lineDiffType: "word", overflow: "scroll" }}
                    style={{ height: "100%" }}
                  />
                </Suspense>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {activePath ? "Nenhuma mudança no arquivo atual." : "Selecione um arquivo."}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ResizablePanel>
  );

  const openFileByPath = useCallback(
    (p: string) =>
      void openFileRef.current({ name: p.split("/").pop() ?? p, path: p, isDir: false }),
    [],
  );
  const onOpenThemeEditor = useCallback(() => setView("themeEditor"), []);
  const onOpenNotifications = useCallback(() => setView("notifications"), []);
  const onToggleNotifications = useCallback(
    () => setView((v) => (v === "notifications" ? "editor" : "notifications")),
    [],
  );
  const onOpenGit = useCallback(() => setView("git"), []);
  const onToggleProblems = useCallback(
    () => setBottomPanel((p) => (p === "problems" ? null : "problems")),
    [],
  );
  const onToggleTerminal = useCallback(
    () => setBottomPanel((p) => (p === "terminal" ? null : "terminal")),
    [],
  );
  const onOpenPalette = useCallback(() => useUiStore.getState().openPalette("> "), []);
  const onToggleZen = useCallback(() => void setZenMode(!zenModeRef.current), [setZenMode]);
  const onCloseFocusedTab = useCallback(() => {
    const path = activePath;
    const leaf = focusedLeaf;
    if (path && leaf) onCloseTab(leaf.id, path);
  }, [activePath, focusedLeaf, onCloseTab]);

  const welcomeEl = (
    <WelcomePage
      onOpenFolder={openFolder}
      onOpenSettings={() => setView("settings")}
      onOpenKeybindings={() => setView("keybindings")}
      onOpenGit={() => setView("git")}
      onOpenOnboarding={() => setView("onboarding")}
      onOpenSpotify={() => setView("spotify")}
      onOpenActions={() => setView("actions")}
      onOpenTests={() => setView("tests")}
      onOpenTasks={() => setView("tasks")}
      recentFolders={recentFolders}
      onOpenRecentFolder={(path) => openFolder(path)}
      onRemoveRecentFolder={removeRecentFolder}
    />
  );

  // PaneTree controla todo o editor (split via drag-and-drop)
  const paneTreeEl = (
    <DevProfiler id="PaneTree">
      <PaneTree
        root={rootPane}
        rootPath={rootPath}
        focusedPaneId={focusedPaneId}
        onFocusPane={setFocusedPaneId}
        onActivateTab={onActivateTab}
        onCloseTab={onCloseTab}
        onReorderTabs={onReorderTabs}
        onChange={updateFile}
        onCursorChange={onCursorChange}
        onMarkersChange={onMarkersChange}
        onDropFile={onDropFile}
        onSplitSizeChange={onSplitSizeChange}
        onOpenFileByPath={openFileByPath}
        onWebviewNavigate={onWebviewNavigate}
        emptyState={welcomeEl}
      />
    </DevProfiler>
  );

  // Layout do editor:
  // - Live preview tem precedência (é independente do tipo de arquivo).
  // - Markdown preview entra quando o tab ativo é markdown e o toggle está ligado.
  // - Caso contrário, só a árvore de panes.
  const showLivePreview = livePreviewOpen;
  const showMarkdownPreview = !showLivePreview && activeTab && isMarkdown && markdownPreviewOpen;

  const editorArea = (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {showLivePreview ? (
        <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
          <ResizablePanel key="editor-area">
            <div className="flex flex-col overflow-hidden h-full">{paneTreeEl}</div>
          </ResizablePanel>
          <ResizablePanel key="live-preview">
            <div className="overflow-hidden h-full">
              <Suspense fallback={<ViewFallback />}>
                <LivePreview />
              </Suspense>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : showMarkdownPreview ? (
        <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
          <ResizablePanel key="editor-area">
            <div className="flex flex-col overflow-hidden h-full">{paneTreeEl}</div>
          </ResizablePanel>
          <ResizablePanel key="md-preview">
            <div className="overflow-hidden h-full">
              <Suspense fallback={<ViewFallback />}>
                <MarkdownPreview content={activeTab!.content} />
              </Suspense>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        paneTreeEl
      )}
    </div>
  );

  const filesProps = useMemo(
    () => ({
      rootPath,
      rootEntries: rootEntries as Entry[],
      onOpenFile: stableOpenFile,
      onRefresh: stableRefreshRoot,
      recentPaths,
    }),
    [rootPath, rootEntries, stableOpenFile, stableRefreshRoot, recentPaths],
  );

  const sidebarPanel = (
    <ResizablePanel key="sidebar" preferredSize="18%" minSize={180} maxSize={600}>
      <aside
        className={`h-full overflow-hidden ${sidebarLocation === "right" ? "border-l" : "border-r"}`}
      >
        <DevProfiler id="Sidebar">
          <Sidebar
            rootPath={rootPath}
            files={filesProps}
            onOpenFile={stableOpenFile}
            onGotoLine={onGotoLine}
          />
        </DevProfiler>
      </aside>
    </ResizablePanel>
  );

  const mainPanel = (
    <ResizablePanel key="main">
      {view === "editor" ||
      view === "settings" ||
      view === "git" ||
      view === "githubProfile" ||
      view === "linear" ? (
        <div style={{ height: "100%", overflow: "hidden" }}>
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel key="editor">
              <div className="relative flex flex-col overflow-hidden h-full">
                {/* Live Preview e Markdown Preview agora são controlados via
                    menu Extensões da TopBar — os botões flutuantes que
                    ficavam aqui foram movidos pra centralizar a UX. */}
                {editorArea}
              </div>
            </ResizablePanel>
            {bottomPanelEl}
          </ResizablePanelGroup>
        </div>
      ) : (
        <div className="h-full flex flex-col overflow-hidden">
          {view !== "bench" && (
            <OverlayHeader
              title={
                view === "about"
                  ? "Sobre"
                  : view === "onboarding"
                    ? "Boas-vindas"
                    : view === "keybindings"
                      ? "Atalhos de teclado"
                      : view === "themeEditor"
                        ? "Editor de tema"
                        : "Editor de texto"
              }
              onClose={() => setView("editor")}
            />
          )}
          <div className="flex-1 overflow-auto">
            <Suspense fallback={<ViewFallback />}>
              {view === "about" && <AboutView />}
              {view === "onboarding" && <OnboardingView onComplete={() => setView("editor")} />}
              {view === "keybindings" && <KeybindingsView />}
              {view === "bench" && <BenchView />}
              {view === "themeEditor" && <ThemeEditor />}
            </Suspense>
          </div>
        </div>
      )}
    </ResizablePanel>
  );

  return (
    <div
      className="w-screen overflow-hidden bg-background text-foreground"
      style={{ display: "grid", gridTemplateRows: "auto 1fr auto", height: "100vh" }}
    >
      {!zenMode && (
        <TopBar
          terminalOpen={bottomPanel === "terminal"}
          problemsOpen={bottomPanel === "problems"}
          zenMode={zenMode as boolean}
          spotifyEnabled={view === "spotify"}
          sidebarVisible={sidebarVisible}
          isMarkdownActive={!!activeTab && isMarkdown}
          onOpenFolder={openFolder}
          onSave={saveActive}
          onCloseTab={onCloseFocusedTab}
          onToggleTerminal={onToggleTerminal}
          onToggleSidebar={onToggleSidebar}
          onToggleProblems={onToggleProblems}
          onSetView={setView}
          onOpenPalette={onOpenPalette}
          onOpenQuickFile={onOpenQuickFile}
          onToggleZen={onToggleZen}
          onToggleSpotify={toggleSpotify}
          onSplitRight={onSplitRight}
          onSplitDown={onSplitDown}
          onOpenUrl={handleOpenUrl}
          onGotoSymbol={onGotoSymbol}
          onFindInFiles={onFindInFiles}
        />
      )}

      <div style={{ overflow: "hidden", minHeight: 0 }}>
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          {sidebarVisible
            ? sidebarLocation === "right"
              ? [mainPanel, sidebarPanel]
              : [sidebarPanel, mainPanel]
            : [mainPanel]}
        </ResizablePanelGroup>
      </div>

      {!zenMode && (
        <DevProfiler id="StatusBar">
          <StatusBar
            activeTab={activeTab}
            activeLang={activeTab ? (activeTab.path.split(".").pop()?.toLowerCase() ?? "") : ""}
            rootPath={rootPath}
            showFps={showFps}
            onOpenGit={onOpenGit}
            onOpenProblems={onToggleProblems}
            onOpenNotifications={onToggleNotifications}
          />
        </DevProfiler>
      )}

      <Overlays
        rootPath={rootPath}
        onOpenFile={openFileByPath}
        onOpenThemeEditor={onOpenThemeEditor}
        onOpenNotifications={onOpenNotifications}
        notificationsOpen={view === "notifications"}
      />
      <ShortcutHud hint={shortcutHint} />
      {view === "settings" && <SettingsOverlay onClose={() => setView("editor")} />}
      {view === "git" && <GitOverlay onClose={() => setView("editor")} rootPath={rootPath} />}
      {view === "notifications" && <NotificationsOverlay onClose={() => setView("editor")} />}
      <Dialog
        open={pendingClose !== null}
        onOpenChange={(o) => {
          if (!o) setPendingClose(null);
        }}
        align="center"
        ariaLabel="Confirmar fechamento de aba"
        className="max-w-md"
      >
        {pendingClose && (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">Salvar alterações?</h2>
              <p className="text-sm text-muted-foreground break-all">
                <span className="font-medium text-foreground">
                  {pendingClose.path.split(/[\\/]/).pop() || pendingClose.path}
                </span>{" "}
                tem alterações não salvas. Se fechar agora, elas serão perdidas.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPendingClose(null)}>
                Cancelar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const { paneId, path } = pendingClose;
                  doCloseTab(paneId, path);
                  setPendingClose(null);
                }}
              >
                Não salvar
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  const { paneId, path } = pendingClose;
                  const leaf = findLeafById(rootPaneRef.current, paneId);
                  const tab = leaf?.tabs.find((t) => t.path === path);
                  if (tab) {
                    try {
                      await WriteFile(tab.path, tab.content);
                      setRootPane((p) => setTabClean(p, path));
                    } catch (e) {
                      console.error(e);
                      return;
                    }
                  }
                  doCloseTab(paneId, path);
                  setPendingClose(null);
                }}
              >
                Salvar
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <SpotifyView overlayOpen={view === "spotify"} onClose={() => setView("editor")} />
      <ActionsView overlayOpen={view === "actions"} onClose={() => setView("editor")} />
      <TestsView
        overlayOpen={view === "tests"}
        onClose={() => setView("editor")}
        rootPath={rootPath}
      />
      <TasksView
        overlayOpen={view === "tasks"}
        onClose={() => setView("editor")}
        rootPath={rootPath}
      />
      <Suspense fallback={null}>
        <GitHubProfileView
          overlayOpen={view === "githubProfile"}
          onClose={() => setView("editor")}
          onOpenFolder={openFolder}
        />
        <LinearView overlayOpen={view === "linear"} onClose={() => setView("editor")} />
      </Suspense>
      <Toaster />
    </div>
  );
}

export default App;
