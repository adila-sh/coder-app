import { useEffect, useMemo, useRef, useState } from "react";
import type * as proto from "vscode-languageserver-protocol";
import { GetLSPPort, ListAvailableLSP } from "../../../../../wailsjs/go/main/LSP";
import { toast } from "@/hooks/useToast";
import type { EditorMarker } from "../../ProblemsPanel";
import type { EditorStore } from "../state/editorStore";
import { AdilaLSPClient, getOrCreateAdilaClient } from "./lspClient";

export type LspApi = {
  hover: (line: number, character: number) => Promise<proto.Hover | null>;
  completion: (line: number, character: number) => Promise<proto.CompletionItem[]>;
  resolveCompletion: (item: proto.CompletionItem) => Promise<proto.CompletionItem>;
  definition: (
    line: number,
    character: number,
  ) => Promise<proto.Location[] | proto.LocationLink[] | null>;
  resolveCodeAction: (action: proto.CodeAction) => Promise<proto.CodeAction>;
  codeActions: (
    range: proto.Range,
    diagnostics?: proto.Diagnostic[],
  ) => Promise<proto.CodeAction[]>;
  formatDocument: (options: proto.FormattingOptions) => Promise<proto.TextEdit[]>;
  formatRange: (range: proto.Range, options: proto.FormattingOptions) => Promise<proto.TextEdit[]>;
  executeCommand: (command: proto.Command) => Promise<void>;
  uri: string | null;
  available: boolean;
};

function lspRouteLang(lang: string): string {
  if (lang === "typescriptreact") return "typescript";
  if (lang === "javascriptreact") return "javascript";
  return lang;
}

function documentLanguageId(lang: string): string {
  return lang;
}

let portCache: number | null = null;
async function getLSPPort(): Promise<number> {
  const cached = portCache;
  if (cached !== null) return cached;
  const next = await GetLSPPort();
  portCache = next;
  return next;
}

let availableCache: Promise<Record<string, string | undefined>> | null = null;
function getAvailableLSP(): Promise<Record<string, string | undefined>> {
  const cached = availableCache;
  if (cached) return cached;
  const next = ListAvailableLSP()
    .then((r: unknown) => r as Record<string, string | undefined>)
    .catch(() => ({}) as Record<string, string | undefined>);
  availableCache = next;
  return next;
}

const MONACO_BUILTIN = new Set(["json", "css", "html"]);
function isLSPRelevant(lang: string) {
  return !!lang && lang !== "plaintext" && !MONACO_BUILTIN.has(lang);
}

const recentErrors = new Set<string>();
function reportError(msg: string, err?: unknown) {
  console.warn(`[LSP] ${msg}`, err);
  if (recentErrors.has(msg)) return;
  recentErrors.add(msg);
  setTimeout(() => recentErrors.delete(msg), 30_000);
  toast.error(msg, err instanceof Error ? err.message : undefined);
}

function pathToUri(path: string): string {
  if (path.startsWith("file://")) return path;
  if (path.startsWith("/")) return `file://${path}`;
  // Windows path
  return `file:///${path.replace(/\\/g, "/")}`;
}

function diagnosticToMarker(d: proto.Diagnostic): EditorMarker {
  // EditorMarker.severity: 8=Error 4=Warning 2=Info 1=Hint (Monaco convention)
  const sev = d.severity === 1 ? 8 : d.severity === 2 ? 4 : d.severity === 3 ? 2 : 1;
  return {
    severity: sev,
    message: d.message,
    startLineNumber: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    source: d.source,
  };
}

type Options = {
  store: EditorStore;
  path: string;
  lang: string;
  rootUri?: string;
  onMarkersChange?: (path: string, markers: EditorMarker[]) => void;
  /** Recebe diagnostics raw pra renderizar squiggle no editor. */
  onDiagnostics?: (diagnostics: proto.Diagnostic[]) => void;
};

const CHANGE_DEBOUNCE_MS = 150;

export function useAdilaLSP({
  store,
  path,
  lang,
  rootUri,
  onMarkersChange,
  onDiagnostics,
}: Options): LspApi {
  const onMarkersRef = useRef(onMarkersChange);
  const onDiagnosticsRef = useRef(onDiagnostics);
  onMarkersRef.current = onMarkersChange;
  onDiagnosticsRef.current = onDiagnostics;

  const clientRef = useRef<AdilaLSPClient | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const routeLang = lspRouteLang(lang);
    if (!rootUri || !isLSPRelevant(routeLang) || !path) {
      setAvailable(false);
      setUri(null);
      clientRef.current = null;
      return;
    }

    let cancelled = false;
    let detach: (() => void) | undefined;
    let storeUnsub: (() => void) | undefined;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const docUri = pathToUri(path);
    console.info("[AdilaLSP] init", { path, lang, routeLang, rootUri, docUri });

    void (async () => {
      const availMap = await getAvailableLSP();
      if (cancelled) return;
      if (!availMap[routeLang]) {
        console.warn("[AdilaLSP] servidor não disponível para", routeLang, "— map:", availMap);
        return;
      }
      console.info("[AdilaLSP] binário encontrado:", availMap[routeLang]);

      let port: number;
      try {
        port = await getLSPPort();
      } catch (err) {
        reportError("Não foi possível obter a porta do servidor LSP", err);
        return;
      }
      if (cancelled) return;

      const client = await getOrCreateAdilaClient({
        lang: routeLang,
        rootUri,
        port,
        onError: reportError,
      });
      if (cancelled || !client) {
        console.warn("[AdilaLSP] cliente não criado", { cancelled, hasClient: !!client });
        return;
      }
      console.info("[AdilaLSP] conectado, capabilities:", client.capabilities);

      const initialText = store.getState().getValue();
      detach = client.openDocument(docUri, initialText, documentLanguageId(lang), (diagnostics) => {
        const markers = diagnostics.map(diagnosticToMarker);
        onMarkersRef.current?.(path, markers);
        onDiagnosticsRef.current?.(diagnostics);
      });
      console.info("[AdilaLSP] didOpen enviado para", docUri);

      clientRef.current = client;
      setUri(docUri);
      setAvailable(true);

      let lastVersion = store.getState().version;
      storeUnsub = store.subscribe((s) => {
        if (s.version === lastVersion) return;
        lastVersion = s.version;
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          if (cancelled) return;
          client.changeDocument(docUri, store.getState().getValue());
        }, CHANGE_DEBOUNCE_MS);
      });
    })();

    return () => {
      cancelled = true;
      if (pendingTimer) clearTimeout(pendingTimer);
      storeUnsub?.();
      detach?.();
      onMarkersRef.current?.(path, []);
      clientRef.current = null;
      setAvailable(false);
      setUri(null);
    };
  }, [store, path, lang, rootUri]);

  const api = useMemo<LspApi>(
    () => ({
      uri,
      available,
      hover: async (line, character) => {
        const c = clientRef.current;
        if (!c || !uri) return null;
        return c.requestHover(uri, line, character);
      },
      completion: async (line, character) => {
        const c = clientRef.current;
        if (!c || !uri) return [];
        return c.requestCompletion(uri, line, character);
      },
      resolveCompletion: async (item) => {
        const c = clientRef.current;
        if (!c) return item;
        return c.resolveCompletion(item);
      },
      definition: async (line, character) => {
        const c = clientRef.current;
        if (!c || !uri) return null;
        return c.requestDefinition(uri, line, character);
      },
      codeActions: async (range, diagnostics) => {
        const c = clientRef.current;
        if (!c || !uri) return [];
        return c.requestCodeActions(uri, range, diagnostics ?? []);
      },
      resolveCodeAction: async (action) => {
        const c = clientRef.current;
        if (!c) return action;
        return c.resolveCodeAction(action);
      },
      formatDocument: async (options) => {
        const c = clientRef.current;
        if (!c || !uri) return [];
        return c.requestDocumentFormatting(uri, options);
      },
      formatRange: async (range, options) => {
        const c = clientRef.current;
        if (!c || !uri) return [];
        return c.requestRangeFormatting(uri, range, options);
      },
      executeCommand: async (command) => {
        const c = clientRef.current;
        if (!c) return;
        await c.executeCommand(command);
      },
    }),
    [uri, available],
  );

  return api;
}

export function invalidateAdilaLSPAvailabilityCache() {
  availableCache = null;
}
