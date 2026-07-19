import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Play,
  RefreshCw,
  Search,
  Square,
  Star,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useWorkspaceConfig } from "@/hooks/useWorkspaceConfig";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Terminal } from "@/components/Terminal";
import { ClosePty } from "../../../wailsjs/go/main/Terminal";
import { tasksRpc } from "./rpc";
import type { TaskDef, TaskKind } from "./types";

type RunningSession = {
  taskId: string;
  sessionId: string;
  label: string;
  command: string;
  running: boolean;
  exitCode?: number;
};

const FAVORITES_DEFAULT: string[] = [];

interface TasksViewProps {
  overlayOpen: boolean;
  onClose: () => void;
  rootPath: string;
}

const KIND_LABEL: Record<TaskKind, string> = {
  npm: "Scripts (package.json)",
  go: "Go",
  cargo: "Cargo",
};

const KIND_ORDER: TaskKind[] = ["npm", "go", "cargo"];

export const TasksView = memo(function TasksView({
  overlayOpen,
  onClose,
  rootPath,
}: TasksViewProps) {
  const [tasks, setTasks] = useState<TaskDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [session, setSession] = useState<RunningSession | null>(null);
  const [query, setQuery] = useState("");
  const { value: favorites, set: setFavorites } = useWorkspaceConfig<string[]>(
    "tasks.favorites",
    FAVORITES_DEFAULT,
  );
  const favSet = useMemo(() => new Set(favorites ?? []), [favorites]);

  const toggleFavorite = useCallback(
    (taskId: string) => {
      const current = favorites ?? [];
      const next = current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId];
      void setFavorites(next).catch((err: unknown) => toast.error("Erro ao salvar favorito", err));
    },
    [favorites, setFavorites],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setError(undefined);
    tasksRpc
      .list()
      .then(setTasks)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const off = tasksRpc.on("tasks.changed", () => refresh());
    return off;
  }, [refresh]);

  const runTask = useCallback((task: TaskDef) => {
    setRunning((s) => new Set(s).add(task.id));
    tasksRpc
      .run(task.id)
      .then((sessionId) => {
        setSession({
          taskId: task.id,
          sessionId,
          label: task.label,
          command: task.command,
          running: true,
        });
      })
      .catch((err: unknown) => toast.error("Erro ao rodar task", err))
      .finally(() =>
        setRunning((s) => {
          const next = new Set(s);
          next.delete(task.id);
          return next;
        }),
      );
  }, []);

  const stopSession = useCallback(() => {
    if (!session) return;
    ClosePty(session.sessionId).catch(() => {});
    setSession(null);
  }, [session]);

  const handleSessionExit = useCallback((code: number) => {
    setSession((prev) => (prev ? { ...prev, running: false, exitCode: code } : prev));
  }, []);

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => {
      return (
        t.label.toLowerCase().includes(q) ||
        (t.detail?.toLowerCase().includes(q) ?? false) ||
        t.command.toLowerCase().includes(q)
      );
    });
  }, [tasks, query]);

  const grouped = useMemo(() => {
    const map = new Map<TaskKind, TaskDef[]>();
    for (const t of filteredTasks) {
      const arr = map.get(t.kind) ?? [];
      arr.push(t);
      map.set(t.kind, arr);
    }
    return map;
  }, [filteredTasks]);

  const favoriteTasks = useMemo(() => {
    const ids = favorites ?? [];
    return ids
      .map((id) => filteredTasks.find((t) => t.id === id))
      .filter(Boolean) as TaskDef[];
  }, [favorites, filteredTasks]);

  useEffect(() => {
    if (!overlayOpen) return;
    refresh();
  }, [overlayOpen, refresh]);

  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayOpen, onClose]);

  if (!overlayOpen) return null;

  const totalTasks = tasks.length;
  const filteredCount = filteredTasks.length;
  const hasSession = session !== null;
  const hasQuery = query.trim().length > 0;

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium min-w-0">
          <ListChecks className="size-4 text-amber-500" />
          <span>Tasks</span>
          {totalTasks > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              · {hasQuery ? `${filteredCount}/${totalTasks}` : totalTasks}
            </span>
          )}
        </div>
        <div className="flex-1 flex justify-center">
          <div className="relative w-full max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar tasks..."
              className="w-full pl-8 pr-8 py-1.5 text-sm rounded-md bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background"
            />
            {hasQuery && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpar pesquisa"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={refresh}
            title="Atualizar"
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer transition-all duration-150 active:scale-90"
          >
            <RefreshCw className={"size-3.5 " + (loading ? "animate-spin" : "")} />
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

      <div
        className={cn(
          "flex-1 grid min-h-0",
          hasSession ? "grid-cols-[320px_minmax(0,1fr)]" : "grid-cols-1",
        )}
      >
        <div className={cn("overflow-y-auto scrollbar min-h-0", hasSession && "border-r")}>
          {!rootPath ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState icon={ListChecks} title="Abra uma pasta para detectar tasks." />
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState icon={AlertCircle} title={error} />
            </div>
          ) : tasks.length === 0 && !loading ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState
                icon={ListChecks}
                title="Nenhuma task detectada."
                description="Suporta package.json, go.mod e Cargo.toml."
              />
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState
                icon={Search}
                title="Nenhum resultado."
                description={`Nenhuma task corresponde a "${query.trim()}".`}
              />
            </div>
          ) : (
            <div className={cn("py-4", hasSession ? "px-3" : "max-w-3xl mx-auto px-4")}>
              {favoriteTasks.length > 0 && (
                <TaskGroup
                  title="Favoritos"
                  tasks={favoriteTasks}
                  running={running}
                  favorites={favSet}
                  activeTaskId={session?.taskId}
                  onRun={runTask}
                  onToggleFavorite={toggleFavorite}
                  accent
                />
              )}
              {KIND_ORDER.map((kind) => {
                const items = grouped.get(kind);
                if (!items || items.length === 0) return null;
                return (
                  <TaskGroup
                    key={kind}
                    title={KIND_LABEL[kind]}
                    tasks={items}
                    running={running}
                    favorites={favSet}
                    activeTaskId={session?.taskId}
                    onRun={runTask}
                    onToggleFavorite={toggleFavorite}
                  />
                );
              })}
            </div>
          )}
        </div>

        {session && (
          <SessionPanel
            session={session}
            onStop={stopSession}
            onClose={() => setSession(null)}
            onExit={handleSessionExit}
          />
        )}
      </div>
    </div>
  );
});

function SessionPanel({
  session,
  onStop,
  onClose,
  onExit,
}: {
  session: RunningSession;
  onStop: () => void;
  onClose: () => void;
  onExit: (code: number) => void;
}) {
  return (
    <div className="flex flex-col min-h-0 bg-background">
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0 gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {session.running ? (
              <Spinner className="size-3.5 text-amber-500" />
            ) : session.exitCode === 0 ? (
              <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
            ) : (
              <span className="size-2 rounded-full bg-destructive shrink-0" />
            )}
            <span className="text-sm font-medium truncate">{session.label}</span>
            {!session.running && (
              <span
                className={cn(
                  "text-[10px] tabular-nums px-1.5 py-0.5 rounded font-mono",
                  session.exitCode === 0
                    ? "bg-emerald-500/10 text-emerald-500"
                    : "bg-destructive/10 text-destructive",
                )}
              >
                exit {session.exitCode}
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">
            {session.command}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {session.running ? (
            <button
              type="button"
              onClick={onStop}
              title="Parar"
              className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive cursor-pointer transition-all duration-150 active:scale-90"
            >
              <Square className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar painel"
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer transition-all duration-150 active:scale-90"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <Terminal key={session.sessionId} sessionId={session.sessionId} active onExit={onExit} />
      </div>
    </div>
  );
}

interface TaskGroupProps {
  title: string;
  tasks: TaskDef[];
  running: Set<string>;
  favorites: Set<string>;
  activeTaskId?: string;
  onRun: (task: TaskDef) => void;
  onToggleFavorite: (taskId: string) => void;
  accent?: boolean;
}

const TaskGroup = memo(function TaskGroup({
  title,
  tasks,
  running,
  favorites,
  activeTaskId,
  onRun,
  onToggleFavorite,
  accent,
}: TaskGroupProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-1.5 px-2 py-1 text-xs font-semibold hover:text-foreground",
          accent ? "text-amber-400" : "text-muted-foreground",
        )}
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        {accent && <Star className="size-3 shrink-0 fill-amber-400" />}
        <span className="flex-1 text-left uppercase tracking-wide">{title}</span>
        <span className="tabular-nums">{tasks.length}</span>
      </button>
      {open && (
        <div className="px-1">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              running={running.has(t.id)}
              active={activeTaskId === t.id}
              favorited={favorites.has(t.id)}
              onRun={onRun}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
      )}
    </div>
  );
});

interface TaskRowProps {
  task: TaskDef;
  running: boolean;
  active?: boolean;
  favorited: boolean;
  onRun: (task: TaskDef) => void;
  onToggleFavorite: (taskId: string) => void;
}

const TaskRow = memo(function TaskRow({
  task,
  running,
  active,
  favorited,
  onRun,
  onToggleFavorite,
}: TaskRowProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 px-2 py-1 text-sm rounded-sm select-none hover:bg-accent/50",
        active && "bg-accent/40",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="truncate text-xs font-medium">{task.label}</div>
        {task.detail && (
          <div className="truncate text-[10px] text-muted-foreground">{task.detail}</div>
        )}
      </div>
      <button
        type="button"
        title={favorited ? "Remover dos favoritos" : "Favoritar"}
        onClick={() => onToggleFavorite(task.id)}
        className={cn(
          "rounded p-1 hover:bg-accent transition-colors",
          favorited
            ? "text-amber-400"
            : "text-muted-foreground hover:text-amber-400",
        )}
      >
        <Star className={cn("size-3.5", favorited && "fill-amber-400")} />
      </button>
      <button
        type="button"
        title={`Rodar: ${task.command}`}
        onClick={() => onRun(task)}
        disabled={running}
        className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-accent disabled:opacity-50"
      >
        {running ? <Spinner className="size-3" /> : <Play className="size-3" />}
      </button>
    </div>
  );
});
