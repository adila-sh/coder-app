import { useCallback, useEffect, useRef, useState } from "react";
import { EventsOn } from "../../../wailsjs/runtime/runtime";
import { CancelRun, DetectRunners, RunTests } from "../../../wailsjs/go/main/Tests";
import type {
  DonePayload,
  LogPayload,
  RunnersPayload,
  StartPayload,
  TestNode,
  TestRunner,
  TestRunSummary,
  TreePayload,
  UpdatePayload,
} from "./types";

type State = {
  runners: TestRunner[];
  loadingRunners: boolean;
  selectedRunnerId: string | null;
  nodesByRunner: Map<string, Map<string, TestNode>>;
  logsByRunner: Map<string, string>;
  summaryByRunner: Map<string, TestRunSummary>;
  error?: string;
};

const initial: State = {
  runners: [],
  loadingRunners: false,
  selectedRunnerId: null,
  nodesByRunner: new Map(),
  logsByRunner: new Map(),
  summaryByRunner: new Map(),
};

export function useTestsStream() {
  const [state, setState] = useState<State>(initial);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const offRunners = EventsOn("tests.runners", (p: RunnersPayload) => {
      setState((s) => ({ ...s, runners: p?.runners ?? [], loadingRunners: false }));
    });
    const offStart = EventsOn("tests.run.start", (p: StartPayload) => {
      setState((s) => {
        const sum = new Map(s.summaryByRunner);
        sum.set(p.summary.runnerId, p.summary);
        const nodes = new Map(s.nodesByRunner);
        nodes.set(p.summary.runnerId, new Map());
        const logs = new Map(s.logsByRunner);
        logs.set(p.summary.runnerId, "");
        return {
          ...s,
          summaryByRunner: sum,
          nodesByRunner: nodes,
          logsByRunner: logs,
          selectedRunnerId: s.selectedRunnerId ?? p.summary.runnerId,
        };
      });
    });
    const offTree = EventsOn("tests.tree", (p: TreePayload) => {
      setState((s) => {
        const next = new Map(s.nodesByRunner);
        const m = new Map<string, TestNode>();
        for (const n of p.nodes ?? []) m.set(n.id, n);
        next.set(p.runnerId, m);
        return { ...s, nodesByRunner: next };
      });
    });
    const offUpdate = EventsOn("tests.update", (p: UpdatePayload) => {
      setState((s) => {
        const next = new Map(s.nodesByRunner);
        const m = new Map(next.get(p.runnerId) ?? new Map<string, TestNode>());
        const prev = m.get(p.node.id);
        // Não regredir status terminal — backend já filtra, defensivo aqui também.
        if (prev && isTerminal(prev.status) && !isTerminal(p.node.status)) return s;
        m.set(p.node.id, p.node);
        next.set(p.runnerId, m);
        return { ...s, nodesByRunner: next };
      });
    });
    const offLog = EventsOn("tests.log", (p: LogPayload) => {
      setState((s) => {
        const next = new Map(s.logsByRunner);
        const cur = next.get(p.runnerId) ?? "";
        const merged = cur + p.chunk;
        // Cap em 1MB pra não estourar memória em runs muito longas.
        const trimmed = merged.length > 1_000_000 ? merged.slice(-1_000_000) : merged;
        next.set(p.runnerId, trimmed);
        return { ...s, logsByRunner: next };
      });
    });
    const offDone = EventsOn("tests.run.done", (p: DonePayload) => {
      setState((s) => {
        const next = new Map(s.summaryByRunner);
        next.set(p.summary.runnerId, p.summary);
        return { ...s, summaryByRunner: next };
      });
    });
    return () => {
      offRunners?.();
      offStart?.();
      offTree?.();
      offUpdate?.();
      offLog?.();
      offDone?.();
    };
  }, []);

  const detect = useCallback(async () => {
    setState((s) => ({ ...s, loadingRunners: true, error: undefined }));
    try {
      const runners = await DetectRunners();
      setState((s) => ({
        ...s,
        runners: runners ?? [],
        loadingRunners: false,
        selectedRunnerId: s.selectedRunnerId ?? runners?.[0]?.id ?? null,
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        loadingRunners: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  const run = useCallback(async (runnerId: string) => {
    try {
      await RunTests(runnerId);
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  const cancel = useCallback(async () => {
    await CancelRun().catch(() => undefined);
  }, []);

  const select = useCallback((runnerId: string) => {
    setState((s) => ({ ...s, selectedRunnerId: runnerId }));
  }, []);

  return { ...state, detect, run, cancel, select };
}

function isTerminal(s: TestNode["status"]): boolean {
  return s === "passed" || s === "failed" || s === "skipped";
}
