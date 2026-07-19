import { lazy, memo, Suspense, useCallback, useState } from "react";
import { Bot, Files, GitBranch, Search } from "lucide-react";
import { DevProfiler } from "@/components/DevProfiler";
import {
  FileExplorer,
  type FileEntry,
  type FileExplorerProps,
} from "@/features/explorer/FileExplorer";
import { SearchView } from "@/features/search/SearchView";

const GitView = lazy(() => import("@/features/git/GitView").then((m) => ({ default: m.GitView })));
const ChatPanel = lazy(() =>
  import("@/features/ai/ChatPanel").then((m) => ({ default: m.ChatPanel })),
);

type Tab = "files" | "search" | "git" | "ai";

type Props = {
  rootPath: string;
  files: FileExplorerProps;
  onOpenFile: (entry: FileEntry) => void;
  onGotoLine?: (path: string, line: number, column: number) => void;
};

const TABS: { id: Tab; label: string; Icon: typeof Files }[] = [
  { id: "files", label: "Arquivos", Icon: Files },
  { id: "search", label: "Buscar", Icon: Search },
  { id: "git", label: "Source Control", Icon: GitBranch },
  { id: "ai", label: "Adila AI", Icon: Bot },
];

export const Sidebar = memo(function Sidebar({ rootPath, files, onOpenFile, onGotoLine }: Props) {
  const [tab, setTab] = useState<Tab>("files");

  const onOpenMatch = useCallback(
    (path: string, line: number, column: number) => {
      onOpenFile({ name: path.split("/").pop() ?? path, path, isDir: false });
      onGotoLine?.(path, line, column);
    },
    [onOpenFile, onGotoLine],
  );

  const onOpenGitFile = useCallback(
    (path: string) => onOpenFile({ name: path.split("/").pop() ?? path, path, isDir: false }),
    [onOpenFile],
  );

  return (
    <div className="h-full flex flex-col">
      <div role="tablist" className="flex border-b shrink-0">
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              title={label}
              onClick={() => setTab(id)}
              className={
                "flex-1 flex items-center justify-center py-2 text-sm border-b-2 transition-colors " +
                (active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent")
              }
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-hidden min-h-0">
        {tab === "files" && (
          <DevProfiler id="FileExplorer">
            <FileExplorer {...files} />
          </DevProfiler>
        )}
        {tab === "search" && <SearchView rootPath={rootPath} onOpenMatch={onOpenMatch} />}
        {tab === "git" && (
          <Suspense fallback={<SidebarFallback />}>
            <GitView compact rootPath={rootPath} onOpenFile={onOpenGitFile} />
          </Suspense>
        )}
        {tab === "ai" && (
          <Suspense fallback={<SidebarFallback />}>
            <ChatPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
});

function SidebarFallback() {
  return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
      Carregando…
    </div>
  );
}
