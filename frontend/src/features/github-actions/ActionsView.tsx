import { memo, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleX,
  Clock,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  StopCircle,
  X,
  XCircle,
} from "lucide-react";
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime";
import { CancelWorkflowRun, RerunWorkflow } from "../../../wailsjs/go/main/GitHub";
import { CheckoutBranch } from "../../../wailsjs/go/main/Git";
import { copyToClipboard, toast } from "@/hooks/useToast";
import { LogViewer } from "./LogViewer";
import type { GitHubJob, GitHubWorkflowRun } from "./types";
import { ACTIVE_STATUSES } from "./types";
import { useActionsStream } from "./useActionsStream";

type Props = {
  overlayOpen: boolean;
  onClose: () => void;
};

export const ActionsView = memo(function ActionsView({ overlayOpen, onClose }: Props) {
  const stream = useActionsStream();
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [selectedJob, setSelectedJob] = useState<number | null>(null);

  useEffect(() => {
    if (!overlayOpen) return;
    stream.start();
    return () => {
      stream.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayOpen]);

  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayOpen, onClose]);

  // Auto-seleciona primeira run quando carrega.
  useEffect(() => {
    if (selectedRun != null) return;
    const first = stream.runs[0];
    if (!first) return;
    setSelectedRun(first.id);
    if (!stream.jobsByRun.has(first.id)) {
      stream.loadJobs(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.runs, selectedRun]);

  const onSelectRun = (run: GitHubWorkflowRun) => {
    setSelectedRun(run.id);
    setSelectedJob(null);
    if (!stream.jobsByRun.has(run.id)) {
      stream.loadJobs(run.id);
    }
  };

  const onSelectJob = (job: GitHubJob) => {
    setSelectedJob(job.id);
    stream.focusJob(job.id);
  };

  const currentRun = useMemo(
    () => stream.runs.find((r) => r.id === selectedRun) ?? null,
    [stream.runs, selectedRun],
  );
  const currentJobs = selectedRun != null ? (stream.jobsByRun.get(selectedRun) ?? []) : [];
  const currentJob = currentJobs.find((j) => j.id === selectedJob) ?? null;
  const currentLogEntry = selectedJob != null ? stream.logs.get(selectedJob) : undefined;

  if (!overlayOpen) return null;

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium min-w-0">
          <Activity className="size-4 text-emerald-500" />
          <span>GitHub Actions</span>
          {stream.status.owner && stream.status.repo && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-xs font-normal text-muted-foreground truncate">
                {stream.status.owner}/{stream.status.repo}
              </span>
            </>
          )}
          {stream.status.watching ? (
            <span
              className="size-1.5 rounded-full bg-emerald-500 animate-pulse"
              title="Observando"
            />
          ) : (
            <span className="size-1.5 rounded-full bg-muted" title="Parado" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void stream.refresh()}
            disabled={!stream.status.watching}
            title="Atualizar"
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer transition-all duration-150 active:scale-90"
          >
            <RefreshCw className={"size-3.5 " + (stream.loading ? "animate-spin" : "")} />
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

      {/* Body */}
      {stream.error ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-sm text-center flex flex-col items-center gap-3">
            <div className="size-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="size-6 text-destructive" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Não foi possível carregar Actions</h2>
              <p className="text-sm text-muted-foreground mt-1">{stream.error}</p>
            </div>
            <button
              type="button"
              onClick={() => void stream.start()}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent cursor-pointer transition-all duration-150 active:scale-95"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      ) : stream.runs.length === 0 && !stream.loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-sm text-center flex flex-col items-center gap-3">
            <div className="size-14 rounded-full bg-muted flex items-center justify-center">
              <Activity className="size-6 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">Nenhum workflow run encontrado</h2>
            <p className="text-sm text-muted-foreground">
              Configure GitHub Actions no seu repositório para ver execuções aqui.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-[320px_minmax(0,1fr)] min-h-0">
          {/* Lista de runs */}
          <aside className="border-r flex flex-col min-h-0 bg-background">
            <div className="px-3 py-2 border-b shrink-0">
              <div className="text-[10px] font-medium uppercase text-muted-foreground tracking-wide">
                Workflow runs ({stream.runs.length})
              </div>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar min-h-0">
              {stream.loading && stream.runs.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">Carregando runs…</div>
              ) : (
                <ul>
                  {stream.runs.map((run) => (
                    <RunListItem
                      key={run.id}
                      run={run}
                      active={selectedRun === run.id}
                      onClick={() => onSelectRun(run)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </aside>

          {/* Detalhes da run + jobs + logs */}
          {currentRun ? (
            <RunDetails
              run={currentRun}
              jobs={currentJobs}
              jobsLoaded={stream.jobsByRun.has(currentRun.id)}
              selectedJob={currentJob}
              logEntry={currentLogEntry}
              onSelectJob={onSelectJob}
              onClearJob={() => setSelectedJob(null)}
            />
          ) : (
            <div className="flex items-center justify-center text-xs text-muted-foreground">
              Selecione uma execução à esquerda
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const RunListItem = memo(function RunListItem({
  run,
  active,
  onClick,
}: {
  run: GitHubWorkflowRun;
  active: boolean;
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
          <StatusIcon status={run.status} conclusion={run.conclusion} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium truncate">{run.name || "Workflow"}</span>
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
              #{run.runNumber}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{run.headBranch}</span>
            <span>·</span>
            <span className="truncate">{run.event}</span>
          </div>
          {run.actor && (
            <div className="flex items-center gap-1.5 mt-1">
              {run.actorAvatar ? (
                <img
                  src={run.actorAvatar}
                  alt=""
                  loading="lazy"
                  className="size-3.5 rounded-full ring-1 ring-border"
                />
              ) : (
                <span className="size-3.5 rounded-full bg-muted" />
              )}
              <span className="text-[10px] text-muted-foreground truncate">{run.actor}</span>
              <span className="text-[10px] text-muted-foreground">·</span>
              <RelativeTime iso={run.updatedAt || run.createdAt} />
              {run.headSha && (
                <>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {run.headSha.slice(0, 7)}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </button>
    </li>
  );
});

const RunDetails = memo(function RunDetails({
  run,
  jobs,
  jobsLoaded,
  selectedJob,
  logEntry,
  onSelectJob,
  onClearJob,
}: {
  run: GitHubWorkflowRun;
  jobs: GitHubJob[];
  jobsLoaded: boolean;
  selectedJob: GitHubJob | null;
  logEntry: { text: string; done: boolean } | undefined;
  onSelectJob: (j: GitHubJob) => void;
  onClearJob: () => void;
}) {
  const isActive = ACTIVE_STATUSES.has(run.status);
  const [acting, setActing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  const onCheckout = async () => {
    if (checkingOut || !run.headSha) return;
    setCheckingOut(true);
    try {
      await CheckoutBranch(run.headSha);
      toast.success(`Checkout em ${run.headSha.slice(0, 7)}`, "HEAD agora aponta pra esse commit");
    } catch (err: unknown) {
      toast.error("Falha no checkout", err);
    } finally {
      setCheckingOut(false);
    }
  };

  const onRerun = async () => {
    if (acting) return;
    setActing(true);
    try {
      await RerunWorkflow(run.htmlUrl.split("/")[3] ?? "", run.htmlUrl.split("/")[4] ?? "", run.id);
    } catch (e) {
      console.error("rerun:", e);
    } finally {
      setActing(false);
    }
  };

  const onCancel = async () => {
    if (acting) return;
    setActing(true);
    try {
      await CancelWorkflowRun(
        run.htmlUrl.split("/")[3] ?? "",
        run.htmlUrl.split("/")[4] ?? "",
        run.id,
      );
    } catch (e) {
      console.error("cancel:", e);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="flex flex-col min-h-0">
      {/* Cabeçalho da run */}
      <div className="px-5 py-4 border-b shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusIcon status={run.status} conclusion={run.conclusion} large />
              <h2 className="text-base font-semibold truncate">{run.name || "Workflow"}</h2>
              <span className="text-sm text-muted-foreground tabular-nums">#{run.runNumber}</span>
              <StatusBadge status={run.status} conclusion={run.conclusion} />
            </div>
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <GitBranch className="size-3" />
                {run.headBranch}
              </span>
              <span>·</span>
              <span>{run.event}</span>
              {run.actor && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1.5">
                    {run.actorAvatar && (
                      <img
                        src={run.actorAvatar}
                        alt=""
                        className="size-4 rounded-full ring-1 ring-border"
                      />
                    )}
                    {run.actor}
                  </span>
                </>
              )}
              {run.headSha && (
                <>
                  <span>·</span>
                  <CopyShaButton sha={run.headSha} />
                </>
              )}
              <span>·</span>
              <RelativeTime iso={run.updatedAt || run.createdAt} />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {run.headSha && (
              <button
                type="button"
                onClick={() => void onCheckout()}
                disabled={checkingOut}
                title={`git checkout ${run.headSha} (detached HEAD)`}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border hover:bg-accent disabled:opacity-50 cursor-pointer transition-all duration-150 active:scale-95"
              >
                {checkingOut ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <GitCommitHorizontal className="size-3.5" />
                )}
                Checkout
              </button>
            )}
            {isActive ? (
              <button
                type="button"
                onClick={() => void onCancel()}
                disabled={acting}
                title="Cancelar run"
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border hover:bg-accent disabled:opacity-50 cursor-pointer transition-all duration-150 active:scale-95"
              >
                <StopCircle className="size-3.5" />
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void onRerun()}
                disabled={acting}
                title="Re-executar workflow"
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border hover:bg-accent disabled:opacity-50 cursor-pointer transition-all duration-150 active:scale-95"
              >
                <RotateCcw className="size-3.5" />
                Re-executar
              </button>
            )}
            {run.htmlUrl && (
              <button
                type="button"
                onClick={() => BrowserOpenURL(run.htmlUrl)}
                title="Abrir no GitHub"
                className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer transition-all duration-150 active:scale-90"
              >
                <ExternalLink className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Painel split: jobs + logs */}
      <div className="flex-1 grid grid-cols-[260px_minmax(0,1fr)] min-h-0">
        <div className="border-r flex flex-col min-h-0">
          <div className="px-3 py-1.5 border-b shrink-0 text-[10px] font-medium uppercase text-muted-foreground tracking-wide">
            Jobs ({jobs.length})
          </div>
          <div className="flex-1 overflow-y-auto scrollbar min-h-0">
            {!jobsLoaded ? (
              <div className="p-3 text-xs text-muted-foreground italic">Carregando jobs…</div>
            ) : jobs.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground italic">Sem jobs.</div>
            ) : (
              <ul>
                {jobs.map((job) => (
                  <JobItem
                    key={job.id}
                    job={job}
                    active={selectedJob?.id === job.id}
                    onClick={() => onSelectJob(job)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col min-h-0">
          {selectedJob ? (
            <>
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusIcon status={selectedJob.status} conclusion={selectedJob.conclusion} />
                  <span className="text-xs font-medium truncate">{selectedJob.name}</span>
                  {logEntry && !logEntry.done && (
                    <span className="text-[10px] text-emerald-500 inline-flex items-center gap-1">
                      <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
                      streaming
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClearJob}
                  title="Fechar logs"
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <LogViewer text={logEntry?.text ?? ""} done={logEntry?.done ?? false} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              Selecione um job para ver os logs
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

const JobItem = memo(function JobItem({
  job,
  active,
  onClick,
}: {
  job: GitHubJob;
  active: boolean;
  onClick: () => void;
}) {
  const [stepsOpen, setStepsOpen] = useState(false);

  return (
    <li className="border-b last:border-0">
      <button
        type="button"
        onClick={onClick}
        className={
          "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors cursor-pointer " +
          (active ? "bg-accent" : "")
        }
      >
        <StatusIcon status={job.status} conclusion={job.conclusion} />
        <span className="text-xs flex-1 truncate">{job.name}</span>
        <Duration startedAt={job.startedAt} completedAt={job.completedAt} />
      </button>
      {job.steps && job.steps.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setStepsOpen((o) => !o)}
            className="w-full flex items-center gap-1 px-3 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/50 cursor-pointer"
          >
            {stepsOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            <span>{job.steps.length} steps</span>
          </button>
          {stepsOpen && (
            <ul className="bg-background/40">
              {job.steps.map((step, idx) => (
                <li
                  key={`${job.id}-${idx}-${step.number}`}
                  className="flex items-center gap-1.5 px-6 py-1 text-[11px]"
                >
                  <StatusIcon status={step.status} conclusion={step.conclusion} />
                  <span className="truncate flex-1">{step.name}</span>
                  <Duration startedAt={step.startedAt} completedAt={step.completedAt} small />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
});

function StatusIcon({
  status,
  conclusion,
  large,
}: {
  status: string;
  conclusion: string;
  large?: boolean;
}) {
  const cls = large ? "size-4 shrink-0" : "size-3 shrink-0";
  if (ACTIVE_STATUSES.has(status)) {
    return <Loader2 className={cls + " text-amber-500 animate-spin"} />;
  }
  if (status === "completed") {
    if (conclusion === "success") return <CheckCircle2 className={cls + " text-emerald-500"} />;
    if (conclusion === "failure") return <XCircle className={cls + " text-destructive"} />;
    if (conclusion === "cancelled") return <CircleX className={cls + " text-muted-foreground"} />;
    if (conclusion === "skipped")
      return <CircleDashed className={cls + " text-muted-foreground"} />;
  }
  return <PlayCircle className={cls + " text-muted-foreground"} />;
}

function StatusBadge({ status, conclusion }: { status: string; conclusion: string }) {
  let label = status;
  let cls = "bg-muted text-muted-foreground";
  if (ACTIVE_STATUSES.has(status)) {
    label =
      status === "in_progress" ? "Em execução" : status === "queued" ? "Na fila" : "Aguardando";
    cls = "bg-amber-500/10 text-amber-600 border border-amber-500/20";
  } else if (status === "completed") {
    if (conclusion === "success") {
      label = "Sucesso";
      cls = "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20";
    } else if (conclusion === "failure") {
      label = "Falha";
      cls = "bg-destructive/10 text-destructive border border-destructive/20";
    } else if (conclusion === "cancelled") {
      label = "Cancelado";
      cls = "bg-muted text-muted-foreground border";
    } else if (conclusion === "skipped") {
      label = "Pulado";
      cls = "bg-muted text-muted-foreground border";
    } else {
      label = conclusion || "Concluído";
    }
  }
  return (
    <span className={"text-[10px] font-medium uppercase tracking-wide rounded px-1.5 py-px " + cls}>
      {label}
    </span>
  );
}

function Duration({
  startedAt,
  completedAt,
  small,
}: {
  startedAt: string;
  completedAt: string;
  small?: boolean;
}) {
  const text = useMemo(() => {
    if (!startedAt) return "";
    const a = Date.parse(startedAt);
    if (isNaN(a)) return "";
    const b = completedAt ? Date.parse(completedAt) : Date.now();
    if (isNaN(b)) return "";
    const ms = Math.max(0, b - a);
    const total = Math.floor(ms / 1000);
    if (total < 60) return `${total}s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return s ? `${m}m${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h${m % 60}m`;
  }, [startedAt, completedAt]);
  if (!text) return null;
  return (
    <span
      className={
        (small ? "text-[10px]" : "text-[11px]") + " text-muted-foreground tabular-nums shrink-0"
      }
    >
      {text}
    </span>
  );
}

function CopyShaButton({ sha }: { sha: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const ok = await copyToClipboard(sha, sha);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      title={copied ? "Copiado!" : `Copiar ${sha} (use git checkout <sha>)`}
      className="group inline-flex items-center gap-1 text-[10px] bg-muted hover:bg-accent border border-transparent hover:border-border px-1.5 py-0.5 rounded font-mono cursor-pointer transition-all duration-150 active:scale-95"
    >
      <span>{sha.slice(0, 7)}</span>
      {copied ? (
        <Check className="size-2.5 text-emerald-500" />
      ) : (
        <Copy className="size-2.5 text-muted-foreground group-hover:text-foreground transition-colors" />
      )}
    </button>
  );
}

function RelativeTime({ iso }: { iso: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const text = useMemo(() => {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (isNaN(t)) return "";
    const diff = Math.max(0, Date.now() - t);
    const s = Math.floor(diff / 1000);
    if (s < 60) return "agora há pouco";
    const m = Math.floor(s / 60);
    if (m < 60) return `há ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `há ${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `há ${d}d`;
    return new Date(t).toLocaleDateString();
  }, [iso]);
  if (!text) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <Clock className="size-3" />
      {text}
    </span>
  );
}
