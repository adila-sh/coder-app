/**
 * Store por instância de AdilaEditor. Mantemos via factory (createStore) ao
 * invés de useStore global porque cada arquivo aberto precisa do próprio
 * buffer/cursors/history.
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import { LineBuffer } from "../buffer/TextBuffer";
import { type Position, type Range, normalizeRange, posCmp } from "../buffer/types";
import {
  type Cursor,
  cursorHasSelection,
  cursorRange,
  makeCursor,
  normalizeCursors,
} from "../cursor/cursorState";
import { TokenizerCache } from "../syntax/tokenize";

export type EditOp = { range: Range; text: string };

export type HistoryEntry = {
  // Inverse-op history: armazenamos as operações em ambas direções em vez de
  // snapshots de string completos. Isso transforma typing num arquivo de 10k
  // linhas de O(text.length) por char em O(1) por char.
  //
  // forwardOps: aplicar em ordem produz o estado pós-edição (usado no redo).
  // inverseOps: aplicar em ordem produz o estado pré-edição (usado no undo).
  //
  // Ambas listas são armazenadas na ordem bottom-up — a mesma ordem de
  // aplicação que preserva offsets durante mutação sequencial.
  forwardOps: EditOp[];
  inverseOps: EditOp[];
  beforeCursors: Cursor[];
  afterCursors: Cursor[];
  // Marker pra agrupamento — edições do mesmo "tipo" (ex.: typing) em <500ms
  // viram um único entry agrupado.
  groupKey?: string;
  ts: number;
};

export type EditorState = {
  buffer: LineBuffer;
  tokenCache: TokenizerCache;
  cursors: Cursor[];
  scrollTop: number;
  scrollLeft: number;
  /** Versão monotônica — incrementa a cada edit pra forçar re-render. */
  version: number;
  langId: string;
  // History
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastEditTs: number;
  lastEditGroup: string | null;
  // Find
  findQuery: string;
  findCaseSensitive: boolean;
  findWholeWord: boolean;
  findRegex: boolean;
  findReplacement: string;
  findError: string | null;
  findMatches: Range[];
  findIndex: number;
};

export type EditorActions = {
  setLanguage: (lang: string) => void;
  setValue: (text: string) => void;
  getValue: () => string;
  setCursors: (cursors: Cursor[]) => void;
  setScroll: (top: number, left: number) => void;
  edit: (op: { range: Range; text: string }[], nextCursors: Cursor[], groupKey?: string) => void;
  insertText: (text: string) => void;
  deleteSelectionOrChar: (direction: "back" | "forward") => void;
  undo: () => void;
  redo: () => void;
  // Find
  setFindQuery: (q: string) => void;
  setFindReplacement: (q: string) => void;
  setFindOptions: (
    opts: Partial<Pick<EditorState, "findCaseSensitive" | "findWholeWord" | "findRegex">>,
  ) => void;
  computeFindMatches: () => void;
  findNext: () => void;
  findPrev: () => void;
  replaceCurrent: () => void;
  replaceAll: () => void;
};

export type EditorStore = StoreApi<EditorState & EditorActions>;

const TYPING_GROUP_MS = 500;

export function createEditorStore(initialText: string, langId: string): EditorStore {
  return createStore<EditorState & EditorActions>((set, get) => {
    const buffer = new LineBuffer(initialText);

    /**
     * Aplica ops *na ordem fornecida* — caller é responsável por garantir que
     * a ordem é válida (bottom-up para batches independentes; ordem original
     * de aplicação para histórico agrupado).
     *
     * Invalida o cache de tokens a partir da linha mínima afetada em vez de
     * reset() — pra evitar retokenização do arquivo inteiro a cada char.
     */
    function applyOpsInOrder(ops: EditOp[]): EditOp[] {
      const buf = get().buffer;
      const inverses: EditOp[] = [];
      let minLine = Infinity;
      for (const op of ops) {
        const norm = normalizeRange(op.range);
        const removed = buf.getRangeText(norm);
        const newRange = buf.replace(norm, op.text);
        inverses.push({ range: newRange, text: removed });
        if (norm.start.line < minLine) minLine = norm.start.line;
      }
      if (minLine !== Infinity) {
        get().tokenCache.invalidateFrom(minLine);
      }
      return inverses;
    }

    /**
     * Para edições novas: ordena bottom-up pra preservar offsets, então aplica.
     * Retorna a sequência aplicada e seus inversos — ambos na mesma ordem
     * (bottom-up) pra serem replayados como uma unidade no undo/redo.
     */
    function applyNewOps(ops: EditOp[]): { applied: EditOp[]; inverses: EditOp[] } {
      const sorted = [...ops].sort(
        (a, b) => -posCmp(normalizeRange(a.range).start, normalizeRange(b.range).start),
      );
      const inverses = applyOpsInOrder(sorted);
      return { applied: sorted, inverses };
    }

    function applyEdit(ops: EditOp[], nextCursors: Cursor[], groupKey?: string) {
      const beforeCursors = get().cursors.map((c) => ({ ...c }));
      const { applied, inverses } = applyNewOps(ops);
      const afterCursors = nextCursors.map((c) => ({ ...c }));

      const now = Date.now();
      const grouped =
        groupKey &&
        get().lastEditGroup === groupKey &&
        now - get().lastEditTs < TYPING_GROUP_MS &&
        get().past.length > 0;

      const entry: HistoryEntry = {
        forwardOps: applied,
        inverseOps: inverses,
        beforeCursors,
        afterCursors,
        groupKey,
        ts: now,
      };

      set((s) => {
        let past = s.past;
        if (grouped) {
          // Merge: forward concat ao final; inverse prepend (aplicar B^-1 antes
          // de A^-1 desfaz a sequência A→B corretamente).
          const last = past[past.length - 1];
          past = [
            ...past.slice(0, -1),
            {
              ...last,
              forwardOps: [...last.forwardOps, ...entry.forwardOps],
              inverseOps: [...entry.inverseOps, ...last.inverseOps],
              afterCursors: entry.afterCursors,
              ts: now,
            },
          ];
        } else {
          past = [...past, entry];
          // Limite simples: 1000 entries.
          if (past.length > 1000) past = past.slice(past.length - 1000);
        }
        return {
          cursors: normalizeCursors(nextCursors),
          version: s.version + 1,
          past,
          future: [],
          lastEditTs: now,
          lastEditGroup: groupKey ?? null,
        };
      });
    }

    return {
      buffer,
      tokenCache: new TokenizerCache(),
      cursors: [makeCursor({ line: 0, col: 0 })],
      scrollTop: 0,
      scrollLeft: 0,
      version: 0,
      langId,
      past: [],
      future: [],
      lastEditTs: 0,
      lastEditGroup: null,
      findQuery: "",
      findCaseSensitive: false,
      findWholeWord: false,
      findRegex: false,
      findReplacement: "",
      findError: null,
      findMatches: [],
      findIndex: -1,

      setLanguage: (lang) => {
        if (get().langId === lang) return;
        get().tokenCache.reset();
        set({ langId: lang, version: get().version + 1 });
      },

      setValue: (text) => {
        const buf = get().buffer;
        buf.setValue(text);
        get().tokenCache.reset();
        // Reseta cursors para 0,0 para evitar posições inválidas.
        set((s) => ({
          cursors: [makeCursor({ line: 0, col: 0 })],
          version: s.version + 1,
          past: [],
          future: [],
        }));
      },

      getValue: () => get().buffer.getValue(),

      setCursors: (cursors) => {
        const norm = normalizeCursors(cursors);
        set({ cursors: norm, lastEditGroup: null });
      },

      setScroll: (top, left) => set({ scrollTop: top, scrollLeft: left }),

      edit: applyEdit,

      insertText: (text) => {
        const cursors = get().cursors;
        const ops = cursors.map((c) => ({ range: cursorRange(c), text }));
        // Calcula nextCursors aplicando o delta de cada inserção sequencial.
        // Como aplicamos de baixo pra cima, podemos calcular nextCursors
        // simulando a posição final de cada cursor independente.
        const nextCursors = cursors.map((c) => {
          const start = posCmp(c.anchor, c.pos) <= 0 ? c.anchor : c.pos;
          // Inserção: nova pos é start + tamanho do texto inserido.
          const inserted = text.split("\n");
          const endPos: Position =
            inserted.length === 1
              ? { line: start.line, col: start.col + inserted[0].length }
              : {
                  line: start.line + inserted.length - 1,
                  col: inserted[inserted.length - 1].length,
                };
          return { pos: endPos, anchor: endPos, desiredCol: endPos.col };
        });
        applyEdit(ops, nextCursors, "type");
      },

      deleteSelectionOrChar: (direction) => {
        const cursors = get().cursors;
        const buf = get().buffer;
        const ops: { range: Range; text: string }[] = [];
        const nextCursors: Cursor[] = [];

        for (const c of cursors) {
          if (cursorHasSelection(c)) {
            const range = cursorRange(c);
            ops.push({ range, text: "" });
            nextCursors.push({
              pos: range.start,
              anchor: range.start,
              desiredCol: range.start.col,
            });
            continue;
          }
          const p = c.pos;
          if (direction === "back") {
            if (p.col === 0 && p.line === 0) {
              nextCursors.push(c);
              continue;
            }
            const start: Position =
              p.col === 0
                ? { line: p.line - 1, col: buf.getLineLength(p.line - 1) }
                : { line: p.line, col: p.col - 1 };
            ops.push({ range: { start, end: p }, text: "" });
            nextCursors.push({ pos: start, anchor: start, desiredCol: start.col });
          } else {
            const lineLen = buf.getLineLength(p.line);
            if (p.col === lineLen && p.line === buf.getLineCount() - 1) {
              nextCursors.push(c);
              continue;
            }
            const end: Position =
              p.col === lineLen ? { line: p.line + 1, col: 0 } : { line: p.line, col: p.col + 1 };
            ops.push({ range: { start: p, end }, text: "" });
            nextCursors.push({ pos: p, anchor: p, desiredCol: p.col });
          }
        }
        if (ops.length === 0) return;
        applyEdit(ops, nextCursors, direction === "back" ? "delback" : "delfwd");
      },

      undo: () => {
        const past = get().past;
        if (past.length === 0) return;
        const last = past[past.length - 1];
        // Aplica os inverses na ordem armazenada — não re-ordena: para grupos,
        // os inverses vêm de estados intermediários e ordens diferentes do doc.
        applyOpsInOrder(last.inverseOps);
        set((s) => ({
          past: past.slice(0, -1),
          future: [...s.future, last],
          cursors: last.beforeCursors.map((c) => ({ ...c })),
          version: s.version + 1,
          lastEditGroup: null,
        }));
      },

      redo: () => {
        const future = get().future;
        if (future.length === 0) return;
        const next = future[future.length - 1];
        applyOpsInOrder(next.forwardOps);
        set((s) => ({
          future: future.slice(0, -1),
          past: [...s.past, next],
          cursors: next.afterCursors.map((c) => ({ ...c })),
          version: s.version + 1,
          lastEditGroup: null,
        }));
      },

      setFindQuery: (q) => {
        set({ findQuery: q });
      },
      setFindReplacement: (q) => {
        set({ findReplacement: q });
      },
      setFindOptions: (opts) => {
        set(opts);
      },
      computeFindMatches: () => {
        const { findQuery, findCaseSensitive, findWholeWord, findRegex, buffer } = get();
        if (!findQuery) {
          set({ findMatches: [], findIndex: -1, findError: null });
          return;
        }
        const matches: Range[] = [];
        let re: RegExp | null = null;
        try {
          if (findRegex) {
            re = new RegExp(findQuery, findCaseSensitive ? "g" : "gi");
          } else {
            const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pat = findWholeWord ? `\\b${escaped}\\b` : escaped;
            re = new RegExp(pat, findCaseSensitive ? "g" : "gi");
          }
        } catch (err) {
          set({
            findMatches: [],
            findIndex: -1,
            findError: err instanceof Error ? err.message : "Regex inválida",
          });
          return;
        }
        for (let line = 0; line < buffer.getLineCount(); line++) {
          const text = buffer.getLine(line);
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
            matches.push({
              start: { line, col: m.index },
              end: { line, col: m.index + m[0].length },
            });
            if (m[0].length === 0) re.lastIndex++;
          }
        }
        set((s) => {
          let nextIndex = matches.length > 0 ? s.findIndex : -1;
          if (nextIndex < 0 && matches.length > 0) nextIndex = 0;
          if (nextIndex >= matches.length) nextIndex = matches.length - 1;
          const primary = s.cursors[0];
          if (primary && matches.length > 0) {
            const atOrAfterCursor = matches.findIndex((m) => posCmp(m.start, primary.pos) >= 0);
            nextIndex = atOrAfterCursor === -1 ? 0 : atOrAfterCursor;
          }
          return { findMatches: matches, findIndex: nextIndex, findError: null };
        });
      },
      findNext: () => {
        const { findMatches, findIndex } = get();
        if (findMatches.length === 0) return;
        const next = (findIndex + 1) % findMatches.length;
        const m = findMatches[next];
        set({
          findIndex: next,
          cursors: [{ pos: m.end, anchor: m.start, desiredCol: m.end.col }],
        });
      },
      findPrev: () => {
        const { findMatches, findIndex } = get();
        if (findMatches.length === 0) return;
        const prev = (findIndex - 1 + findMatches.length) % findMatches.length;
        const m = findMatches[prev];
        set({
          findIndex: prev,
          cursors: [{ pos: m.end, anchor: m.start, desiredCol: m.end.col }],
        });
      },
      replaceCurrent: () => {
        const { findMatches, findIndex, findReplacement } = get();
        if (findMatches.length === 0 || findIndex < 0) return;
        const match = findMatches[findIndex];
        const end = advancePosition(match.start, findReplacement);
        applyEdit(
          [{ range: match, text: findReplacement }],
          [{ pos: end, anchor: end, desiredCol: end.col }],
          "replace",
        );
        get().computeFindMatches();
      },
      replaceAll: () => {
        const { findMatches, findReplacement } = get();
        if (findMatches.length === 0) return;
        const ops = findMatches.map((range) => ({ range, text: findReplacement }));
        const first = findMatches[0];
        const end = advancePosition(first.start, findReplacement);
        applyEdit(ops, [{ pos: end, anchor: end, desiredCol: end.col }], "replace-all");
        get().computeFindMatches();
      },
    };
  });
}

function advancePosition(start: Position, text: string): Position {
  const lines = text.split("\n");
  if (lines.length === 1) return { line: start.line, col: start.col + lines[0].length };
  return { line: start.line + lines.length - 1, col: lines[lines.length - 1].length };
}
