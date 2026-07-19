/**
 * EditorView — núcleo de renderização. Estrutura:
 *
 *  ┌──────────────────────────────────────────┐
 *  │ scroll container (rolagem v + h)         │
 *  │  ┌─────┬───────────────────────────────┐ │
 *  │  │ gut │ content (linhas + overlays)  │ │
 *  │  │ ter │                              │ │
 *  │  └─────┴───────────────────────────────┘ │
 *  └──────────────────────────────────────────┘
 *
 * Linhas renderizadas via janela virtual: só linhas visíveis (+ overscan)
 * existem no DOM. Cursor/seleção desenhados por overlay absoluto.
 *
 * Input: textarea invisível posicionado no caret pra capturar IME e
 * paste/copy nativo. Os events sobem pro store.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Position, Range } from "../buffer/types";
import { posCmp } from "../buffer/types";
import { cursorRange, cursorHasSelection, makeCursor } from "../cursor/cursorState";
import {
  moveDown,
  moveLeft,
  moveLineEnd,
  moveLineStart,
  moveRight,
  moveUp,
  moveWordLeft,
  moveWordRight,
  wordRangeAt,
} from "../cursor/movement";
import type { EditorStore } from "../state/editorStore";
import { LineRow } from "./LineRow";
import { Minimap } from "./Minimap";
import { SelectionLayer } from "./SelectionLayer";
import { DiagnosticsLayer } from "./DiagnosticsLayer";
import { HoverPopup } from "./HoverPopup";
import { CompletionPopup } from "./CompletionPopup";
import { CodeActionPopup } from "./CodeActionPopup";
import {
  buildLayout,
  segmentForVisualRow,
  positionToVisualPoint,
  visualPointToPosition,
} from "./layout";
import { EventsEmit } from "../../../../../wailsjs/runtime/runtime";
import { tryResolveImportDefinition } from "../definitionFallback";
import type { LspApi } from "../lsp/useAdilaLSP";
import {
  editsFromCompletion,
  editsFromWorkspaceEdit,
  finalPositionAfterEdit,
} from "../lsp/applyLspEdits";
import type * as proto from "vscode-languageserver-protocol";
import { measureCharWidth } from "./metrics";

const PADDING_TOP = 8;
const GUTTER_PADDING_X = 12;
const GUTTER_MIN_DIGITS = 2;
const OVERSCAN = 6;

type Props = {
  store: EditorStore;
  filePath: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  showLineNumbers: boolean;
  relativeLineNumbers: boolean;
  highlightCurrentLine: boolean;
  wordWrap: boolean;
  tabSize: number;
  caretBlink: boolean;
  smoothScroll: boolean;
  showMinimap?: boolean;
  readOnly: boolean;
  diagnostics?: proto.Diagnostic[];
  lspApi?: LspApi;
  onCursorChange?: (line: number, col: number) => void;
  onChange?: (value: string) => void;
};

const MINIMAP_WIDTH = 100;

export function EditorView({
  store,
  filePath,
  fontFamily,
  fontSize,
  lineHeight,
  showLineNumbers,
  relativeLineNumbers,
  highlightCurrentLine,
  wordWrap,
  tabSize,
  caretBlink,
  smoothScroll,
  showMinimap = false,
  readOnly,
  diagnostics,
  lspApi,
  onCursorChange,
  onChange,
}: Props) {
  const state = useStore(store);
  const { buffer, cursors, version, langId, tokenCache, findMatches, findIndex } = state;

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const charWidth = useMemo(() => measureCharWidth(fontFamily, fontSize), [fontFamily, fontSize]);
  const lineCount = buffer.getLineCount();

  // Largura do gutter ajusta com nº de dígitos do total de linhas.
  const gutterDigits = Math.max(GUTTER_MIN_DIGITS, String(lineCount).length);
  const gutterWidth = showLineNumbers ? gutterDigits * charWidth + GUTTER_PADDING_X * 2 : 0;

  const availableContentWidth = Math.max(0, viewport.width - gutterWidth - 16);
  const layout = useMemo(
    () => buildLayout(buffer, lineHeight, charWidth, tabSize, wordWrap, availableContentWidth),
    [buffer, version, lineHeight, charWidth, tabSize, wordWrap, availableContentWidth],
  );
  const totalHeight = layout.totalHeight + PADDING_TOP * 2;
  const contentWidth = wordWrap
    ? Math.max(viewport.width, (layout.wrapColumn ?? 1) * charWidth + 64)
    : Math.max(viewport.width, layout.maxVisualColumn * charWidth + 64);

  // Tokenização incremental até o limite visível.
  const scrollTop = state.scrollTop;
  const visibleTop = Math.max(0, scrollTop - PADDING_TOP);
  const visibleBottom = visibleTop + viewport.height;
  const firstVisualRow = Math.max(0, Math.floor(visibleTop / lineHeight) - OVERSCAN);
  const lastVisualRow = Math.min(
    Math.max(0, layout.totalRows - 1),
    Math.ceil(visibleBottom / lineHeight) + OVERSCAN,
  );
  const firstVisible = Math.max(0, layout.visualLineToLogicalLine(firstVisualRow));
  const lastVisible = Math.min(lineCount - 1, layout.visualLineToLogicalLine(lastVisualRow));

  tokenCache.tokenizeUpTo((i) => buffer.getLine(i), lineCount, lastVisible, langId);

  // Resize observer.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reporta cursor primário para o host.
  const primary = cursors[0];
  useEffect(() => {
    if (primary) onCursorChange?.(primary.pos.line + 1, primary.pos.col + 1);
  }, [primary, onCursorChange]);

  // Mantém resultados de busca sincronizados com edições locais.
  useEffect(() => {
    if (state.findQuery) state.computeFindMatches();
  }, [version, state.findQuery, state.findCaseSensitive, state.findWholeWord, state.findRegex]);

  // Reporta valor para o host quando o version muda. Evita ciclo: se a
  // mudança veio de fora (setValue) ou de bumps colaterais (setLanguage no
  // mount), inicializa o ref com o valor atual no primeiro run pra não
  // disparar onChange e marcar a aba como dirty sem edição real.
  const lastReportedRef = useRef<{ version: number; value: string } | null>(null);
  useEffect(() => {
    const current = buffer.getValue();
    if (lastReportedRef.current === null) {
      lastReportedRef.current = { version, value: current };
      return;
    }
    if (version === lastReportedRef.current.version) return;
    if (current !== lastReportedRef.current.value) {
      lastReportedRef.current = { version, value: current };
      onChange?.(current);
    } else {
      lastReportedRef.current = { version, value: current };
    }
  }, [version, buffer, onChange]);

  // Garante que o cursor primário fica visível ao mover, considerando wrap e tabs.
  useLayoutEffect(() => {
    if (!primary || !scrollerRef.current) return;
    const el = scrollerRef.current;
    const point = positionToVisualPoint(layout, primary.pos);
    const top = point.top + PADDING_TOP;
    const left = point.column * charWidth;
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (top + lineHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.min(maxScrollTop, top + lineHeight - el.clientHeight);
    }
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (left + charWidth > el.scrollLeft + el.clientWidth - gutterWidth - 16) {
      el.scrollLeft = left + charWidth - el.clientWidth + gutterWidth + 16;
    }
  }, [primary, layout, lineHeight, charWidth, gutterWidth]);

  // Navegação por find move o cursor; garante que o match atual fique visível.
  useLayoutEffect(() => {
    if (findIndex < 0 || findMatches.length === 0 || !scrollerRef.current) return;
    const match = findMatches[findIndex];
    const el = scrollerRef.current;
    const point = positionToVisualPoint(layout, match.start);
    const top = point.top + PADDING_TOP;
    const left = point.column * charWidth;
    if (top < el.scrollTop || top + lineHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - Math.floor(el.clientHeight / 3));
    }
    if (left < el.scrollLeft || left + charWidth > el.scrollLeft + el.clientWidth - gutterWidth) {
      el.scrollLeft = Math.max(0, left - gutterWidth - 32);
    }
  }, [findIndex, findMatches, layout, lineHeight, charWidth, gutterWidth]);

  // Foco automático no textarea quando o container recebe click.
  function focusTextarea() {
    textareaRef.current?.focus({ preventScroll: true });
  }

  // Cursor → posição → reposiciona textarea (importante pro IME).
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !primary) return;
    const point = positionToVisualPoint(layout, primary.pos);
    const top = PADDING_TOP + point.top;
    const left = gutterWidth + point.column * charWidth;
    ta.style.top = `${top}px`;
    ta.style.left = `${left}px`;
  }, [primary, layout, charWidth, gutterWidth]);

  // Mouse → posição lógica, convertendo coluna visual (tabs/wrap) para col real.
  function pointerToPos(clientX: number, clientY: number): Position {
    const el = scrollerRef.current;
    if (!el) return { line: 0, col: 0 };
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft - gutterWidth;
    const y = clientY - rect.top + el.scrollTop - PADDING_TOP;
    return visualPointToPosition(layout, Math.max(0, y), Math.max(0, Math.round(x / charWidth)));
  }

  const dragRef = useRef<{ anchor: Position; mode: "char" | "word" | "line" } | null>(null);

  // Hover LSP — debounce mouse-move por 350ms, cancela se o mouse sai do
  // container ou move pra outro identificador.
  const [hoverState, setHoverState] = useState<{
    hover: proto.Hover;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPosRef = useRef<Position | null>(null);
  const hoverOverPopupRef = useRef(false);
  const [definitionHint, setDefinitionHint] = useState<Range | null>(null);
  const [caretSteady, setCaretSteady] = useState(false);
  const caretSteadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pulseCaret() {
    setCaretSteady(true);
    if (caretSteadyTimerRef.current) clearTimeout(caretSteadyTimerRef.current);
    caretSteadyTimerRef.current = setTimeout(() => {
      caretSteadyTimerRef.current = null;
      setCaretSteady(false);
    }, 650);
  }

  useEffect(() => {
    return () => {
      if (caretSteadyTimerRef.current) clearTimeout(caretSteadyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    pulseCaret();
  }, [primary?.pos.line, primary?.pos.col]);

  function clearHover() {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (!hoverOverPopupRef.current) {
      setHoverState(null);
      hoverPosRef.current = null;
    }
    setDefinitionHint(null);
  }

  // Completion popup state
  const [completionState, setCompletionState] = useState<{
    items: proto.CompletionItem[];
    /** Posição (col) onde começou o filter no buffer. */
    triggerLine: number;
    triggerCol: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const [codeActionState, setCodeActionState] = useState<{
    actions: proto.CodeAction[];
    anchorX: number;
    anchorY: number;
  } | null>(null);

  /** Texto digitado entre triggerCol e cursor atual — usado pra filtrar. */
  function completionFilter(): string {
    if (!completionState || !primary) return "";
    if (primary.pos.line !== completionState.triggerLine) return "";
    const line = buffer.getLine(primary.pos.line);
    return line.slice(completionState.triggerCol, primary.pos.col);
  }

  async function triggerCompletion() {
    if (!lspApi?.available || !primary) {
      console.warn("[AdilaEditor] completion ignorada", {
        available: lspApi?.available,
        hasCursor: !!primary,
      });
      return;
    }
    const items = await lspApi.completion(primary.pos.line, primary.pos.col);
    console.info("[AdilaEditor] completion retornou", items.length, "items");
    if (items.length === 0) return;
    // triggerCol = início do identificador antes do cursor.
    const line = buffer.getLine(primary.pos.line);
    let col = primary.pos.col;
    while (col > 0 && /[\w]/.test(line[col - 1] ?? "")) col--;
    const el = scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const triggerPoint = positionToVisualPoint(layout, { line: primary.pos.line, col });
    const anchorX = rect.left - el.scrollLeft + gutterWidth + 4 + triggerPoint.x * charWidth;
    const anchorY = rect.top - el.scrollTop + PADDING_TOP + triggerPoint.y;
    setCompletionState({
      items,
      triggerLine: primary.pos.line,
      triggerCol: col,
      anchorX,
      anchorY,
    });
  }

  async function acceptCompletion(item: proto.CompletionItem) {
    if (!completionState || !primary) return;
    const resolved = item.data ? await lspApi?.resolveCompletion(item) : item;
    const target = resolved ?? item;
    const fallbackRange = {
      start: { line: completionState.triggerLine, col: completionState.triggerCol },
      end: { line: primary.pos.line, col: primary.pos.col },
    };
    const ops = editsFromCompletion(target, fallbackRange);
    if (ops.length === 0) return;
    const primaryOp =
      ops.find(
        (op) =>
          op.range.start.line === fallbackRange.start.line &&
          op.range.start.col === fallbackRange.start.col,
      ) ?? ops[0];
    const finalPos = finalPositionAfterEdit(primaryOp);
    store
      .getState()
      .edit(ops, [{ pos: finalPos, anchor: finalPos, desiredCol: finalPos.col }], "completion");
    setCompletionState(null);
  }

  async function goToDefinitionAt(pos: Position) {
    const openTarget = (targetPath: string, line: number, column: number) => {
      EventsEmit("editor.openFile", targetPath);
      setTimeout(
        () =>
          EventsEmit("editor.gotoLine", {
            line,
            column,
          }),
        80,
      );
    };

    if (lspApi?.available) {
      const res = await lspApi.definition(pos.line, pos.col);
      if (res && res.length > 0) {
        const first = res[0];
        const uri = "targetUri" in first ? first.targetUri : first.uri;
        const range = "targetSelectionRange" in first ? first.targetSelectionRange : first.range;
        if (uri && range) {
          const targetPath = decodeURIComponent(uri.replace(/^file:\/\//, ""));
          openTarget(targetPath, range.start.line + 1, range.start.character + 1);
          return;
        }
      }
    }

    const fallback = await tryResolveImportDefinition(filePath, buffer.getValue(), pos);
    if (!fallback) return;
    openTarget(fallback.path, fallback.line + 1, fallback.col + 1);
  }

  async function openCodeActions(posOverride?: Position) {
    const pos = posOverride ?? primary?.pos;
    if (!lspApi?.available || !pos) return;
    const range = primary && !posOverride ? cursorRange(primary) : { start: pos, end: pos };
    const relatedDiagnostics =
      diagnostics?.filter((d) =>
        rangesOverlap(range, {
          start: { line: d.range.start.line, col: d.range.start.character },
          end: { line: d.range.end.line, col: d.range.end.character },
        }),
      ) ?? [];
    const actions = await lspApi.codeActions(toLspRange(range), relatedDiagnostics);
    if (actions.length === 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const point = positionToVisualPoint(layout, pos);
    setCodeActionState({
      actions,
      anchorX: rect.left - el.scrollLeft + gutterWidth + 4 + point.x * charWidth,
      anchorY: rect.top - el.scrollTop + PADDING_TOP + point.y,
    });
  }

  async function acceptCodeAction(action: proto.CodeAction) {
    const resolved = !action.edit && action.data ? await lspApi?.resolveCodeAction(action) : action;
    const edit = resolved?.edit;
    let applied = false;
    if (edit) {
      const ops = editsFromWorkspaceEdit(edit, lspApi?.uri);
      if (ops.length > 0) {
        const primaryAfter = ops[0].range.start;
        store
          .getState()
          .edit(
            ops,
            [{ pos: primaryAfter, anchor: primaryAfter, desiredCol: primaryAfter.col }],
            "code-action",
          );
        applied = true;
      }
    }
    if (resolved?.command) {
      await lspApi?.executeCommand(resolved.command);
    } else if (!applied && "command" in action && action.command) {
      await lspApi?.executeCommand(action.command);
    }
    setCodeActionState(null);
  }

  async function formatDocumentOrSelection() {
    if (!lspApi?.available || !lspApi.uri || !primary) return;
    const opts: proto.FormattingOptions = { tabSize, insertSpaces: true };
    const edits = cursorHasSelection(primary)
      ? await lspApi.formatRange(toLspRange(cursorRange(primary)), opts)
      : await lspApi.formatDocument(opts);
    if (edits.length === 0) return;
    const ops = edits.map((edit) => ({
      range: {
        start: { line: edit.range.start.line, col: edit.range.start.character },
        end: { line: edit.range.end.line, col: edit.range.end.character },
      },
      text: edit.newText,
    }));
    const pos = ops[0].range.start;
    store.getState().edit(ops, [{ pos, anchor: pos, desiredCol: pos.col }], "format");
  }

  function scheduleHover(clientX: number, clientY: number) {
    if (!lspApi?.available) return;
    const pos = pointerToPos(clientX, clientY);
    // Não dispara se mesma posição.
    const last = hoverPosRef.current;
    if (last && last.line === pos.line && last.col === pos.col) return;

    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(async () => {
      hoverTimerRef.current = null;
      const result = await lspApi.hover(pos.line, pos.col);
      if (!result) {
        setHoverState(null);
        return;
      }
      hoverPosRef.current = pos;
      // Âncora: posição em screen do início do range (ou da posição atual).
      const el = scrollerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const anchorLine = result.range?.start.line ?? pos.line;
      const anchorCol = result.range?.start.character ?? pos.col;
      const anchorPoint = positionToVisualPoint(layout, { line: anchorLine, col: anchorCol });
      const anchorX = rect.left - el.scrollLeft + gutterWidth + 4 + anchorPoint.x * charWidth;
      const anchorY = rect.top - el.scrollTop + PADDING_TOP + anchorPoint.y;
      setHoverState({ hover: result, anchorX, anchorY });
    }, 350);
  }

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    focusTextarea();
    const pos = pointerToPos(e.clientX, e.clientY);

    if (e.ctrlKey || e.metaKey) {
      void goToDefinitionAt(pos);
      return;
    }

    setHoverState(null);
    setCompletionState(null);
    setCodeActionState(null);

    if (e.altKey) {
      // Alt+click: adiciona cursor.
      store.getState().setCursors([...cursors, makeCursor(pos)]);
      return;
    }

    if (e.detail === 2) {
      // double-click: word
      const r = wordRangeAt(buffer, pos);
      store.getState().setCursors([{ pos: r.end, anchor: r.start, desiredCol: r.end.col }]);
      dragRef.current = { anchor: r.start, mode: "word" };
      return;
    }
    if (e.detail >= 3) {
      // triple-click: line
      const start: Position = { line: pos.line, col: 0 };
      const end: Position =
        pos.line < lineCount - 1
          ? { line: pos.line + 1, col: 0 }
          : { line: pos.line, col: buffer.getLineLength(pos.line) };
      store.getState().setCursors([{ pos: end, anchor: start, desiredCol: end.col }]);
      dragRef.current = { anchor: start, mode: "line" };
      return;
    }

    const anchor = e.shiftKey && primary ? primary.anchor : pos;
    store.getState().setCursors([{ pos, anchor, desiredCol: pos.col }]);
    dragRef.current = { anchor, mode: "char" };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) {
      // Sem drag: agenda hover LSP.
      scheduleHover(e.clientX, e.clientY);
      return;
    }
    const pos = pointerToPos(e.clientX, e.clientY);
    const drag = dragRef.current;
    if (drag.mode === "char") {
      store.getState().setCursors([{ pos, anchor: drag.anchor, desiredCol: pos.col }]);
    } else if (drag.mode === "word") {
      const r = wordRangeAt(buffer, pos);
      const useStart = posCmp(pos, drag.anchor) < 0;
      store
        .getState()
        .setCursors([
          useStart
            ? { pos: r.start, anchor: drag.anchor, desiredCol: r.start.col }
            : { pos: r.end, anchor: drag.anchor, desiredCol: r.end.col },
        ]);
    } else if (drag.mode === "line") {
      const useStart = posCmp(pos, drag.anchor) < 0;
      const target: Position = useStart
        ? { line: pos.line, col: 0 }
        : pos.line < lineCount - 1
          ? { line: pos.line + 1, col: 0 }
          : { line: pos.line, col: buffer.getLineLength(pos.line) };
      store.getState().setCursors([{ pos: target, anchor: drag.anchor, desiredCol: target.col }]);
    }
  }

  function onMouseUp() {
    dragRef.current = null;
  }

  // Keyboard handler central. Roda no textarea (que tem foco) — nada chega
  // se outro elemento estiver focado.
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const s = store.getState();
    const meta = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moveSelectedLines(s, e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (meta && !shift && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      copySelectedLines(s, e.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (e.key === "F12") {
      e.preventDefault();
      if (primary) void goToDefinitionAt(primary.pos);
      return;
    }
    if ((meta && e.key === ".") || (meta && shift && (e.key === "A" || e.key === "a"))) {
      e.preventDefault();
      void openCodeActions();
      return;
    }

    // Ctrl+Space: trigger completion manualmente
    if (meta && e.key === " ") {
      e.preventDefault();
      void triggerCompletion();
      return;
    }
    if (e.key === "F12") {
      e.preventDefault();
      if (primary) void goToDefinitionAt(primary.pos);
      return;
    }
    if ((meta && e.key === ".") || (meta && shift && (e.key === "a" || e.key === "A"))) {
      e.preventDefault();
      void openCodeActions();
      return;
    }

    // Movement
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const next = s.cursors.map((c) => {
        const newPos = meta ? moveWordLeft(buffer, c.pos) : moveLeft(buffer, c.pos);
        return {
          pos: newPos,
          anchor: shift ? c.anchor : newPos,
          desiredCol: newPos.col,
        };
      });
      s.setCursors(next);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = s.cursors.map((c) => {
        const newPos = meta ? moveWordRight(buffer, c.pos) : moveRight(buffer, c.pos);
        return {
          pos: newPos,
          anchor: shift ? c.anchor : newPos,
          desiredCol: newPos.col,
        };
      });
      s.setCursors(next);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = s.cursors.map((c) => {
        const newPos = moveUp(buffer, c.pos, c.desiredCol);
        return { pos: newPos, anchor: shift ? c.anchor : newPos, desiredCol: c.desiredCol };
      });
      s.setCursors(next);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = s.cursors.map((c) => {
        const newPos = moveDown(buffer, c.pos, c.desiredCol);
        return { pos: newPos, anchor: shift ? c.anchor : newPos, desiredCol: c.desiredCol };
      });
      s.setCursors(next);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      const next = s.cursors.map((c) => {
        const newPos = meta ? { line: 0, col: 0 } : moveLineStart(buffer, c.pos);
        return { pos: newPos, anchor: shift ? c.anchor : newPos, desiredCol: newPos.col };
      });
      s.setCursors(next);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      const next = s.cursors.map((c) => {
        const newPos = meta
          ? { line: lineCount - 1, col: buffer.getLineLength(lineCount - 1) }
          : moveLineEnd(buffer, c.pos);
        return { pos: newPos, anchor: shift ? c.anchor : newPos, desiredCol: newPos.col };
      });
      s.setCursors(next);
      return;
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const dir = e.key === "PageDown" ? 1 : -1;
      const visibleLines = Math.max(1, Math.floor(viewport.height / lineHeight) - 1);
      const next = s.cursors.map((c) => {
        const targetLine = Math.max(0, Math.min(lineCount - 1, c.pos.line + dir * visibleLines));
        const newPos: Position = {
          line: targetLine,
          col: Math.min(c.desiredCol, buffer.getLineLength(targetLine)),
        };
        return { pos: newPos, anchor: shift ? c.anchor : newPos, desiredCol: c.desiredCol };
      });
      s.setCursors(next);
      return;
    }

    // Edit
    if (readOnly) return;

    if (e.key === "Backspace") {
      e.preventDefault();
      s.deleteSelectionOrChar("back");
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      s.deleteSelectionOrChar("forward");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      insertNewlineWithIndent(s, tabSize);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (shift) outdentSelection(s, tabSize);
      else indentSelection(s, tabSize);
      return;
    }

    // Shortcuts
    if (meta && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (shift) s.redo();
      else s.undo();
      return;
    }
    if (meta && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      s.redo();
      return;
    }
    if (meta && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      const lastLine = lineCount - 1;
      s.setCursors([
        {
          pos: { line: lastLine, col: buffer.getLineLength(lastLine) },
          anchor: { line: 0, col: 0 },
          desiredCol: buffer.getLineLength(lastLine),
        },
      ]);
      return;
    }
    if (meta && (e.key === "d" || e.key === "D")) {
      // Adiciona próxima ocorrência da palavra/seleção atual ao multi-cursor.
      e.preventDefault();
      addNextOccurrence(s);
      return;
    }
    if (meta && (e.key === "l" || e.key === "L")) {
      // Seleciona linha inteira.
      e.preventDefault();
      const next = s.cursors.map((c) => {
        const start: Position = { line: c.pos.line, col: 0 };
        const end: Position =
          c.pos.line < lineCount - 1
            ? { line: c.pos.line + 1, col: 0 }
            : { line: c.pos.line, col: buffer.getLineLength(c.pos.line) };
        return { pos: end, anchor: start, desiredCol: end.col };
      });
      s.setCursors(next);
      return;
    }
    if (meta && e.key === "/") {
      // Toggle line comment.
      e.preventDefault();
      toggleLineComment(s);
      return;
    }
    if (e.altKey && shift && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      void formatDocumentOrSelection();
      return;
    }
    if (meta && shift && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      copySelectedLines(s, 1);
      return;
    }
    if (meta && shift && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      deleteSelectedLines(s);
      return;
    }
    if (e.key === "Escape") {
      // Reduz a 1 cursor (descarta multi-cursor).
      if (s.cursors.length > 1) {
        e.preventDefault();
        s.setCursors([s.cursors[0]]);
      }
      return;
    }

    // Caracteres imprimíveis caem no onInput do textarea (cobre IME também).
  }

  function onInput(e: React.FormEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    const v = ta.value;
    if (v.length === 0) return;
    ta.value = "";
    if (readOnly) return;
    insertTextWithPairs(store.getState(), v);
    // Auto-trigger completion no ponto, ou refresh se já aberto.
    const lastChar = v[v.length - 1];
    if (lastChar === "." || lastChar === ":") {
      void triggerCompletion();
    }
  }

  async function onCopy(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const s = store.getState();
    const parts = s.cursors.map((c) =>
      cursorHasSelection(c) ? buffer.getRangeText(cursorRange(c)) : buffer.getLine(c.pos.line),
    );
    e.clipboardData.setData("text/plain", parts.join("\n"));
  }

  function onCut(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (readOnly) return;
    e.preventDefault();
    const s = store.getState();
    const parts = s.cursors.map((c) =>
      cursorHasSelection(c) ? buffer.getRangeText(cursorRange(c)) : buffer.getLine(c.pos.line),
    );
    e.clipboardData.setData("text/plain", parts.join("\n"));
    // Se nenhum cursor tem seleção, remove a linha inteira.
    if (s.cursors.every((c) => !cursorHasSelection(c))) {
      // Delete linha
      const ops = s.cursors.map((c) => {
        const startLine = c.pos.line;
        const start: Position = { line: startLine, col: 0 };
        const end: Position =
          startLine < lineCount - 1
            ? { line: startLine + 1, col: 0 }
            : { line: startLine, col: buffer.getLineLength(startLine) };
        return { range: { start, end }, text: "" };
      });
      const next = s.cursors.map((c) => ({
        pos: { line: c.pos.line, col: 0 },
        anchor: { line: c.pos.line, col: 0 },
        desiredCol: 0,
      }));
      s.edit(ops, next, "cut-line");
      return;
    }
    s.deleteSelectionOrChar("back");
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (readOnly) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const s = store.getState();
    // Se nº de linhas do clipboard == nº de cursors, aplica linha-a-linha.
    const lines = text.split("\n");
    if (lines.length === s.cursors.length && s.cursors.length > 1) {
      const ops = s.cursors.map((c, i) => ({ range: cursorRange(c), text: lines[i] }));
      const next = s.cursors.map((c, i) => {
        const r = cursorRange(c);
        const newCol = r.start.col + lines[i].length;
        return {
          pos: { line: r.start.line, col: newCol },
          anchor: { line: r.start.line, col: newCol },
          desiredCol: newCol,
        };
      });
      s.edit(ops, next, "paste-multi");
      return;
    }
    s.insertText(text);
  }

  // Render
  const rows: React.ReactNode[] = [];
  for (let visualRow = firstVisualRow; visualRow <= lastVisualRow; visualRow++) {
    const segment = segmentForVisualRow(buffer, layout, visualRow, tabSize);
    const top = PADDING_TOP + visualRow * lineHeight;
    const sliceText = buffer.getLine(segment.line).slice(segment.startCol, segment.endCol);
    rows.push(
      <div
        key={`${segment.line}:${segment.segment}`}
        className="ade-line"
        style={{
          position: "absolute",
          top,
          left: 0,
          right: 0,
          height: lineHeight,
          paddingLeft: 4,
          whiteSpace: "pre",
          fontVariantLigatures: "common-ligatures",
          zIndex: 2,
        }}
      >
        <LineRow
          text={sliceText}
          tokens={tokenCache.getLineTokens(segment.line)}
          startCol={segment.startCol}
          tabSize={tabSize}
        />
      </div>,
    );
  }

  // Linha atual destacada.
  const currentLineTop = primary
    ? PADDING_TOP + positionToVisualPoint(layout, primary.pos).top
    : -9999;

  // Gutter rows (line numbers).
  const gutterRows: React.ReactNode[] = [];
  if (showLineNumbers) {
    for (let i = firstVisible; i <= lastVisible; i++) {
      const top = PADDING_TOP + (layout.lineStarts[i] ?? 0) * lineHeight;
      const height =
        ((layout.lineStarts[i + 1] ?? layout.lineStarts[i] ?? 0) - (layout.lineStarts[i] ?? 0)) *
        lineHeight;
      const num =
        relativeLineNumbers && primary
          ? i === primary.pos.line
            ? i + 1
            : Math.abs(i - primary.pos.line)
          : i + 1;
      const isCurrent = primary && i === primary.pos.line;
      gutterRows.push(
        <div
          key={i}
          className={`ade-gutter-row${isCurrent ? " ade-gutter-current" : ""}`}
          style={{
            position: "absolute",
            top,
            left: 0,
            right: GUTTER_PADDING_X,
            height,
            textAlign: "right",
            paddingRight: GUTTER_PADDING_X,
            fontFamily,
            fontSize,
            lineHeight: `${lineHeight}px`,
          }}
        >
          {num}
        </div>,
      );
    }
  }

  return (
    <div
      ref={containerRef}
      className={`ade-root${caretBlink ? " ade-caret-blink" : ""}${caretSteady ? " ade-caret-steady" : ""}`}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        fontFamily,
        fontSize,
        lineHeight: `${lineHeight}px`,
        cursor: "text",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={clearHover}
    >
      <div
        ref={scrollerRef}
        className="ade-scroller"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          right: showMinimap ? MINIMAP_WIDTH : 0,
          overflow: "auto",
          scrollBehavior: smoothScroll ? "smooth" : "auto",
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          store.getState().setScroll(el.scrollTop, el.scrollLeft);
        }}
      >
        <div
          style={{
            position: "relative",
            width: gutterWidth + contentWidth,
            height: totalHeight,
          }}
        >
          {/* current line bg */}
          {highlightCurrentLine && primary && (
            <div
              className="ade-current-line"
              style={{
                position: "absolute",
                top: currentLineTop,
                left: 0,
                width: "100%",
                height: lineHeight,
                pointerEvents: "none",
                zIndex: 0,
              }}
            />
          )}

          {/* gutter */}
          {showLineNumbers && (
            <div
              className="ade-gutter"
              style={{
                position: "sticky",
                left: 0,
                top: 0,
                width: gutterWidth,
                height: totalHeight,
                float: "left",
                pointerEvents: "none",
                zIndex: 2,
              }}
            >
              {gutterRows}
            </div>
          )}

          {/* área de texto: deslocada pra direita do gutter */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: gutterWidth,
              right: 0,
              height: totalHeight,
            }}
          >
            {rows}
            <SelectionLayer
              cursors={cursors}
              layout={layout}
              charWidth={charWidth}
              lineHeight={lineHeight}
              paddingLeft={4}
              paddingTop={PADDING_TOP}
              findMatches={findMatches}
              findIndex={findIndex}
              definitionRange={definitionHint}
            />
            {diagnostics && diagnostics.length > 0 && (
              <DiagnosticsLayer
                diagnostics={diagnostics}
                layout={layout}
                charWidth={charWidth}
                lineHeight={lineHeight}
                paddingLeft={4}
                paddingTop={PADDING_TOP}
                firstVisible={firstVisible}
                lastVisible={lastVisible}
                onOpenCodeActions={(line, col) => {
                  const pos = { line, col };
                  store.getState().setCursors([{ pos, anchor: pos, desiredCol: col }]);
                  void openCodeActions(pos);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {showMinimap && viewport.height > 0 && (
        <Minimap
          buffer={buffer}
          tokenCache={tokenCache}
          langId={langId}
          bufferVersion={version}
          width={MINIMAP_WIDTH}
          scrollTop={state.scrollTop}
          viewportHeight={viewport.height}
          contentHeight={totalHeight}
          editorLineHeight={lineHeight}
          onScrollTo={(top) => {
            const el = scrollerRef.current;
            if (el) el.scrollTop = top;
          }}
        />
      )}

      <textarea
        ref={textareaRef}
        className="ade-input"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        style={{
          position: "absolute",
          width: 1,
          height: lineHeight,
          opacity: 0,
          padding: 0,
          border: 0,
          outline: "none",
          resize: "none",
          zIndex: 3,
          pointerEvents: "none",
        }}
      />
      {hoverState && (
        <HoverPopup
          hover={hoverState.hover}
          anchorX={hoverState.anchorX}
          anchorY={hoverState.anchorY}
          lineHeight={lineHeight}
          onMouseEnter={() => {
            hoverOverPopupRef.current = true;
          }}
          onMouseLeave={() => {
            hoverOverPopupRef.current = false;
            setHoverState(null);
            hoverPosRef.current = null;
          }}
        />
      )}
      {completionState && (
        <CompletionPopup
          items={completionState.items}
          filter={completionFilter()}
          anchorX={completionState.anchorX}
          anchorY={completionState.anchorY}
          lineHeight={lineHeight}
          onAccept={acceptCompletion}
          onClose={() => setCompletionState(null)}
        />
      )}
      {codeActionState && (
        <CodeActionPopup
          actions={codeActionState.actions}
          anchorX={codeActionState.anchorX}
          anchorY={codeActionState.anchorY}
          lineHeight={lineHeight}
          onAccept={acceptCodeAction}
          onClose={() => setCodeActionState(null)}
        />
      )}
    </div>
  );
}

function rangesOverlap(
  a: { start: Position; end: Position },
  b: { start: Position; end: Position },
) {
  return posCmp(a.start, b.end) <= 0 && posCmp(b.start, a.end) <= 0;
}

function toLspRange(range: { start: Position; end: Position }): proto.Range {
  return {
    start: { line: range.start.line, character: range.start.col },
    end: { line: range.end.line, character: range.end.col },
  };
}

function touchedLines(s: ReturnType<EditorStore["getState"]>): number[] {
  const lines = new Set<number>();
  for (const c of s.cursors) {
    const r = cursorRange(c);
    const endLine = r.end.col === 0 && r.end.line > r.start.line ? r.end.line - 1 : r.end.line;
    for (let line = r.start.line; line <= endLine; line++) lines.add(line);
  }
  return Array.from(lines).sort((a, b) => a - b);
}

function insertNewlineWithIndent(s: ReturnType<EditorStore["getState"]>, tabSize: number) {
  if (s.cursors.length !== 1) {
    s.insertText("\n");
    return;
  }
  const c = s.cursors[0];
  const line = s.buffer.getLine(c.pos.line);
  const range = cursorRange(c);
  const before = cursorHasSelection(c) ? "" : line.slice(0, c.pos.col);
  const after = cursorHasSelection(c) ? "" : line.slice(c.pos.col);
  let indent = "";
  for (const ch of line) {
    if (ch === " " || ch === "\t") indent += ch;
    else break;
  }
  const extra = /[{[(]\s*$/.test(before) ? " ".repeat(tabSize) : "";
  const shouldOutdentClose = !!extra && /^\s*[})\]]/.test(after);
  if (shouldOutdentClose) {
    const text = "\n" + indent + extra + "\n" + indent;
    const pos = { line: range.start.line + 1, col: indent.length + extra.length };
    s.edit([{ range, text }], [{ pos, anchor: pos, desiredCol: pos.col }], "enter");
    return;
  }
  s.insertText("\n" + indent + extra);
}

function indentSelection(s: ReturnType<EditorStore["getState"]>, tabSize: number) {
  const indent = " ".repeat(tabSize);
  const lines = touchedLines(s);
  if (lines.length === 0) {
    s.insertText(indent);
    return;
  }
  const ops = lines.map((line) => ({
    range: { start: { line, col: 0 }, end: { line, col: 0 } },
    text: indent,
  }));
  const shiftPos = (p: Position): Position =>
    lines.includes(p.line) ? { line: p.line, col: p.col + indent.length } : p;
  const next = s.cursors.map((c) => ({
    pos: shiftPos(c.pos),
    anchor: shiftPos(c.anchor),
    desiredCol: shiftPos(c.pos).col,
  }));
  s.edit(ops, next, "indent");
}

function outdentSelection(s: ReturnType<EditorStore["getState"]>, tabSize: number) {
  const lines = touchedLines(s);
  const ops = [];
  const removedByLine = new Map<number, number>();
  for (const line of lines) {
    const text = s.buffer.getLine(line);
    const remove = text.startsWith("\t")
      ? 1
      : Math.min(tabSize, text.match(/^ */)?.[0].length ?? 0);
    if (remove <= 0) continue;
    removedByLine.set(line, remove);
    ops.push({ range: { start: { line, col: 0 }, end: { line, col: remove } }, text: "" });
  }
  if (ops.length === 0) return;
  const shiftPos = (p: Position): Position => {
    const removed = removedByLine.get(p.line) ?? 0;
    return removed > 0 ? { line: p.line, col: Math.max(0, p.col - removed) } : p;
  };
  const next = s.cursors.map((c) => ({
    pos: shiftPos(c.pos),
    anchor: shiftPos(c.anchor),
    desiredCol: shiftPos(c.pos).col,
  }));
  s.edit(ops, next, "outdent");
}

function insertTextWithPairs(s: ReturnType<EditorStore["getState"]>, text: string) {
  if (text.length !== 1 || s.cursors.length !== 1) {
    s.insertText(text);
    return;
  }
  const pairs: Record<string, string> = {
    "(": ")",
    "[": "]",
    "{": "}",
    '"': '"',
    "'": "'",
    "`": "`",
  };
  const closing = new Set(Object.values(pairs));
  const close = pairs[text];
  const c = s.cursors[0];
  if (
    closing.has(text) &&
    !cursorHasSelection(c) &&
    s.buffer.getLine(c.pos.line)[c.pos.col] === text
  ) {
    const pos = { line: c.pos.line, col: c.pos.col + 1 };
    s.setCursors([{ pos, anchor: pos, desiredCol: pos.col }]);
    return;
  }
  if (!close) {
    s.insertText(text);
    return;
  }
  if ((text === '"' || text === "'" || text === "`") && !cursorHasSelection(c)) {
    const prev = s.buffer.getLine(c.pos.line)[c.pos.col - 1] ?? "";
    if (/\w/.test(prev)) {
      s.insertText(text);
      return;
    }
  }
  if (cursorHasSelection(c)) {
    const selected = s.buffer.getRangeText(cursorRange(c));
    const r = cursorRange(c);
    const wrapped = text + selected + close;
    const selectionStart = { line: r.start.line, col: r.start.col + 1 };
    const selectionEnd = finalPositionAfterEdit({ range: r, text: text + selected });
    s.edit(
      [{ range: r, text: wrapped }],
      [{ pos: selectionEnd, anchor: selectionStart, desiredCol: selectionEnd.col }],
      "pair-wrap",
    );
    return;
  }
  const pos = { line: c.pos.line, col: c.pos.col + 1 };
  s.edit(
    [{ range: cursorRange(c), text: text + close }],
    [{ pos, anchor: pos, desiredCol: pos.col }],
    "pair",
  );
}

function lineRangeForLine(s: ReturnType<EditorStore["getState"]>, line: number) {
  const last = s.buffer.getLineCount() - 1;
  const start = { line, col: 0 };
  const end =
    line < last ? { line: line + 1, col: 0 } : { line, col: s.buffer.getLineLength(line) };
  return { start, end };
}

function deleteSelectedLines(s: ReturnType<EditorStore["getState"]>) {
  const lines = touchedLines(s);
  if (lines.length === 0) return;
  const ranges = lines.map((line) => lineRangeForLine(s, line));
  const targetLine = Math.max(0, Math.min(lines[0], s.buffer.getLineCount() - lines.length - 1));
  const pos = { line: targetLine, col: 0 };
  s.edit(
    ranges.map((range) => ({ range, text: "" })),
    [{ pos, anchor: pos, desiredCol: 0 }],
    "delete-lines",
  );
}

function copySelectedLines(s: ReturnType<EditorStore["getState"]>, dir: 1 | -1) {
  const lines = touchedLines(s);
  if (lines.length === 0) return;
  const first = lines[0];
  const last = lines[lines.length - 1];
  const text = lines.map((line) => s.buffer.getLine(line)).join("\n");
  const insertLine = dir > 0 ? last + 1 : first;
  const suffix = dir > 0 && last === s.buffer.getLineCount() - 1 ? "\n" : "";
  const insertText = dir > 0 ? "\n" + text : text + "\n";
  const pos = { line: dir > 0 ? first + lines.length : first, col: 0 };
  s.edit(
    [
      {
        range: { start: { line: insertLine, col: 0 }, end: { line: insertLine, col: 0 } },
        text: insertText + suffix,
      },
    ],
    [{ pos, anchor: pos, desiredCol: 0 }],
    "copy-lines",
  );
}

function moveSelectedLines(s: ReturnType<EditorStore["getState"]>, dir: 1 | -1) {
  const lines = touchedLines(s);
  if (lines.length === 0) return;
  const first = lines[0];
  const last = lines[lines.length - 1];
  const lineCount = s.buffer.getLineCount();
  if ((dir < 0 && first === 0) || (dir > 0 && last >= lineCount - 1)) return;

  const block = lines.map((line) => s.buffer.getLine(line)).join("\n");
  if (dir < 0) {
    const above = s.buffer.getLine(first - 1);
    const range = {
      start: { line: first - 1, col: 0 },
      end: { line: last, col: s.buffer.getLineLength(last) },
    };
    const text = block + "\n" + above;
    const pos = { line: Math.max(0, s.cursors[0].pos.line - 1), col: s.cursors[0].pos.col };
    s.edit([{ range, text }], [{ pos, anchor: pos, desiredCol: pos.col }], "move-lines");
    return;
  }
  const below = s.buffer.getLine(last + 1);
  const range = {
    start: { line: first, col: 0 },
    end: { line: last + 1, col: s.buffer.getLineLength(last + 1) },
  };
  const text = below + "\n" + block;
  const pos = {
    line: Math.min(lineCount - 1, s.cursors[0].pos.line + 1),
    col: s.cursors[0].pos.col,
  };
  s.edit([{ range, text }], [{ pos, anchor: pos, desiredCol: pos.col }], "move-lines");
}

function addNextOccurrence(s: ReturnType<EditorStore["getState"]>) {
  const buf = s.buffer;
  const last = s.cursors[s.cursors.length - 1];
  const range = cursorHasSelection(last) ? cursorRange(last) : wordRangeAt(buf, last.pos);
  if (range.start.line !== range.end.line) return; // V0: só palavra/seleção single-line
  const needle = buf.getRangeText(range);
  if (!needle) return;
  const startOff = buf.offsetAt(range.end);
  const text = buf.getValue();
  const idx = text.indexOf(needle, startOff);
  const finalIdx = idx === -1 ? text.indexOf(needle) : idx;
  if (finalIdx === -1) return;
  const startPos = buf.positionAt(finalIdx);
  const endPos = buf.positionAt(finalIdx + needle.length);
  s.setCursors([...s.cursors, { pos: endPos, anchor: startPos, desiredCol: endPos.col }]);
}

function toggleLineComment(s: ReturnType<EditorStore["getState"]>) {
  const buf = s.buffer;
  const lang = s.langId;
  // Importação dinâmica seria overkill aqui — usa map local conhecido.
  const lineCommentMap: Record<string, string> = {
    typescript: "// ",
    javascript: "// ",
    go: "// ",
    rust: "// ",
    python: "# ",
    shell: "# ",
    scss: "// ",
    json: "// ",
  };
  const prefix = lineCommentMap[lang] ?? "// ";

  // Coleta todas as linhas atingidas pelos cursors.
  const linesSet = new Set<number>();
  for (const c of s.cursors) {
    const r = cursorRange(c);
    for (let l = r.start.line; l <= r.end.line; l++) linesSet.add(l);
  }
  const lines = Array.from(linesSet).sort((a, b) => a - b);
  // Decide: se TODAS já estão comentadas, descomenta; senão comenta.
  const allCommented = lines.every((l) => buf.getLine(l).trimStart().startsWith(prefix.trim()));

  const ops = lines.map((l) => {
    const text = buf.getLine(l);
    if (allCommented) {
      const idx = text.indexOf(prefix.trim());
      const after = text.slice(idx + prefix.trim().length);
      const cleaned = after.startsWith(" ") ? after.slice(1) : after;
      return {
        range: { start: { line: l, col: 0 }, end: { line: l, col: text.length } },
        text: text.slice(0, idx) + cleaned,
      };
    }
    // Insere prefixo no primeiro non-ws.
    let firstNonWs = 0;
    while (firstNonWs < text.length && /\s/.test(text[firstNonWs])) firstNonWs++;
    return {
      range: { start: { line: l, col: firstNonWs }, end: { line: l, col: firstNonWs } },
      text: prefix,
    };
  });
  s.edit(ops, s.cursors, "toggle-comment");
}
