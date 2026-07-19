import type { LineBuffer } from "../buffer/TextBuffer";
import type { Position } from "../buffer/types";
import type { Token } from "../syntax/tokenize";

export type VisualLine = {
  visualIndex: number;
  line: number;
  segment: number;
  startCol: number;
  endCol: number;
  startVisualCol: number;
  endVisualCol: number;
  top: number;
};

export type VisualLayout = {
  wrapColumn: number | null;
  lineStarts: number[];
  totalRows: number;
  visualLineCount: number;
  totalHeight: number;
  maxVisualColumn: number;
  lines: VisualLine[];
  lineToFirstVisual: number[];
  visualLineToLogicalLine: (visualRow: number) => number;
  positionToPoint: (pos: Position) => {
    x: number;
    y: number;
    visualRow: number;
    column: number;
    top: number;
  };
  pointToPosition: (y: number, visualColumn: number) => Position;
};

export function visualColumn(text: string, col: number, tabSize: number): number {
  let visual = 0;
  const end = Math.max(0, Math.min(col, text.length));
  for (let i = 0; i < end; i++) {
    if (text[i] === "\t") {
      visual += tabSize - (visual % tabSize);
    } else {
      visual++;
    }
  }
  return visual;
}

export function colFromVisualColumn(text: string, target: number, tabSize: number): number {
  let visual = 0;
  const clamped = Math.max(0, target);
  for (let col = 0; col < text.length; col++) {
    const width = text[col] === "\t" ? tabSize - (visual % tabSize) : 1;
    if (visual + width / 2 >= clamped) return col;
    if (visual + width > clamped) return col + 1;
    visual += width;
  }
  return text.length;
}

export function visualLength(text: string, tabSize: number): number {
  return visualColumn(text, text.length, tabSize);
}

export function buildVisualLayout(
  buffer: LineBuffer,
  tabSize: number,
  wrapColumn: number | null,
  lineHeight = 1,
): VisualLayout {
  const lineCount = buffer.getLineCount();
  const lineStarts: number[] = Array.from({ length: lineCount + 1 });
  const lines: VisualLine[] = [];
  const lineToFirstVisual: number[] = Array.from({ length: lineCount });
  let total = 0;
  let maxVisualColumn = 1;
  for (let line = 0; line < lineCount; line++) {
    lineStarts[line] = total;
    lineToFirstVisual[line] = total;
    const text = buffer.getLine(line);
    const len = visualLength(text, tabSize);
    maxVisualColumn = Math.max(maxVisualColumn, len);
    const segments = wrapColumn ? Math.max(1, Math.ceil(Math.max(1, len) / wrapColumn)) : 1;
    for (let segment = 0; segment < segments; segment++) {
      const startVisualCol = wrapColumn ? segment * wrapColumn : 0;
      const endVisualCol = wrapColumn ? Math.min(len, (segment + 1) * wrapColumn) : len;
      const startCol = wrapColumn ? colFromVisualColumn(text, startVisualCol, tabSize) : 0;
      const endCol = wrapColumn ? colFromVisualColumn(text, endVisualCol, tabSize) : text.length;
      lines.push({
        visualIndex: total + segment,
        line,
        segment,
        startCol,
        endCol: Math.max(startCol, endCol),
        startVisualCol,
        endVisualCol,
        top: (total + segment) * lineHeight,
      });
    }
    total += segments;
  }
  lineStarts[lineCount] = total;
  const layout: VisualLayout = {
    wrapColumn,
    lineStarts,
    totalRows: total,
    visualLineCount: total,
    totalHeight: total * lineHeight,
    maxVisualColumn,
    lines,
    lineToFirstVisual,
    visualLineToLogicalLine: (visualRow) => lineForVisualRow(layout, visualRow),
    positionToPoint: (pos) => {
      const visualRow = visualRowForPosition(buffer, layout, pos, tabSize);
      const column = visualLeftForPosition(buffer, layout, pos, tabSize);
      return {
        x: column,
        y: visualRow * lineHeight,
        visualRow,
        column,
        top: visualRow * lineHeight,
      };
    },
    pointToPosition: (y, visualColumn) =>
      positionFromVisualPoint(buffer, layout, Math.floor(y / lineHeight), visualColumn, tabSize),
  };
  return layout;
}

export function buildLayout(
  buffer: LineBuffer,
  lineHeight: number,
  _charWidth: number,
  tabSize: number,
  wordWrap: boolean,
  availableContentWidth: number,
): VisualLayout {
  const wrapColumn =
    wordWrap && availableContentWidth > 0
      ? Math.max(8, Math.floor(availableContentWidth / Math.max(1, _charWidth)))
      : null;
  return buildVisualLayout(buffer, tabSize, wrapColumn, lineHeight);
}

export function lineForVisualRow(layout: VisualLayout, visualRow: number): number {
  const row = Math.max(0, Math.min(visualRow, Math.max(0, layout.totalRows - 1)));
  let lo = 0;
  let hi = layout.lineStarts.length - 2;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (layout.lineStarts[mid] <= row && row < layout.lineStarts[mid + 1]) return mid;
    if (row < layout.lineStarts[mid]) hi = mid - 1;
    else lo = mid + 1;
  }
  return Math.max(0, Math.min(layout.lineStarts.length - 2, lo));
}

export function visualRowForPosition(
  buffer: LineBuffer,
  layout: VisualLayout,
  pos: Position,
  tabSize: number,
): number {
  const base = layout.lineStarts[pos.line] ?? 0;
  if (!layout.wrapColumn) return base;
  const col = visualColumn(buffer.getLine(pos.line), pos.col, tabSize);
  return base + Math.floor(col / layout.wrapColumn);
}

export function visualLeftForPosition(
  buffer: LineBuffer,
  layout: VisualLayout,
  pos: Position,
  tabSize: number,
): number {
  const col = visualColumn(buffer.getLine(pos.line), pos.col, tabSize);
  return layout.wrapColumn ? col % layout.wrapColumn : col;
}

export function positionFromVisualPoint(
  buffer: LineBuffer,
  layout: VisualLayout,
  visualRow: number,
  visualCol: number,
  tabSize: number,
): Position {
  const line = lineForVisualRow(layout, visualRow);
  const rowInLine = visualRow - (layout.lineStarts[line] ?? 0);
  const targetCol =
    (layout.wrapColumn ? rowInLine * layout.wrapColumn : 0) + Math.max(0, visualCol);
  return { line, col: colFromVisualColumn(buffer.getLine(line), targetCol, tabSize) };
}

export function segmentForVisualRow(
  buffer: LineBuffer,
  layout: VisualLayout,
  visualRow: number,
  tabSize: number,
): {
  line: number;
  segment: number;
  startCol: number;
  endCol: number;
  startVisualCol: number;
  endVisualCol: number;
} {
  const line = lineForVisualRow(layout, visualRow);
  const segment = visualRow - (layout.lineStarts[line] ?? 0);
  if (!layout.wrapColumn) {
    return {
      line,
      segment: 0,
      startCol: 0,
      endCol: buffer.getLineLength(line),
      startVisualCol: 0,
      endVisualCol: visualLength(buffer.getLine(line), tabSize),
    };
  }
  const text = buffer.getLine(line);
  const startCol = colFromVisualColumn(text, segment * layout.wrapColumn, tabSize);
  const endCol = colFromVisualColumn(text, (segment + 1) * layout.wrapColumn, tabSize);
  return {
    line,
    segment,
    startCol,
    endCol: Math.max(startCol, endCol),
    startVisualCol: segment * layout.wrapColumn,
    endVisualCol: (segment + 1) * layout.wrapColumn,
  };
}

export function positionToVisualPoint(layout: VisualLayout, pos: Position) {
  return layout.positionToPoint(pos);
}

export function visualPointToPosition(
  layout: VisualLayout,
  y: number,
  visualColumn: number,
): Position {
  return layout.pointToPosition(y, visualColumn);
}

export function visualColumnAt(text: string, col: number, tabSize: number): number {
  return visualColumn(text, col, tabSize);
}

export function clipTokens(tokens: Token[], startCol: number, endCol: number): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    const start = Math.max(token.start, startCol);
    const end = Math.min(token.end, endCol);
    if (start < end) {
      out.push({ type: token.type, start: start - startCol, end: end - startCol });
    }
  }
  return out;
}
