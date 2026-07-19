import { memo } from "react";
import type { Cursor } from "../cursor/cursorState";
import { cursorRange, cursorHasSelection } from "../cursor/cursorState";
import type { Range } from "../buffer/types";
import type { VisualLayout } from "./layout";

type Props = {
  cursors: Cursor[];
  charWidth: number;
  lineHeight: number;
  paddingLeft: number;
  paddingTop: number;
  findMatches?: Range[];
  findIndex?: number;
  definitionRange?: Range | null;
  layout: VisualLayout;
};

/** Desenha retângulos para cada linha de cada seleção, mais cursors. */
function SelectionLayerInner({
  cursors,
  charWidth,
  lineHeight,
  paddingLeft,
  paddingTop,
  findMatches,
  findIndex,
  definitionRange,
  layout,
}: Props) {
  const rects: React.ReactNode[] = [];
  const carets: React.ReactNode[] = [];

  // Find highlights primeiro (atrás da seleção).
  if (findMatches && findMatches.length > 0) {
    for (let i = 0; i < findMatches.length; i++) {
      const m = findMatches[i];
      pushSelectionRects(
        rects,
        m,
        charWidth,
        lineHeight,
        paddingLeft,
        paddingTop,
        layout,
        i === findIndex ? "find-current" : "find-match",
        `f${i}`,
      );
    }
  }

  if (definitionRange) {
    pushSelectionRects(
      rects,
      definitionRange,
      charWidth,
      lineHeight,
      paddingLeft,
      paddingTop,
      layout,
      "definition-link",
      "def",
    );
  }

  cursors.forEach((c, idx) => {
    if (cursorHasSelection(c)) {
      pushSelectionRects(
        rects,
        cursorRange(c),
        charWidth,
        lineHeight,
        paddingLeft,
        paddingTop,
        layout,
        "selection",
        `s${idx}`,
      );
    }
    const caretVisual = layout.positionToPoint(c.pos);
    const top = paddingTop + caretVisual.y;
    const left = paddingLeft + caretVisual.x * charWidth;
    carets.push(
      <span
        key={`c${idx}`}
        className="ade-caret"
        style={{
          position: "absolute",
          top,
          left,
          height: lineHeight,
          width: 2,
        }}
      />,
    );
  });

  return (
    <>
      <div
        className="ade-selection-layer"
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }}
      >
        {rects}
      </div>
      <div
        className="ade-caret-layer"
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}
      >
        {carets}
      </div>
    </>
  );
}

function pushSelectionRects(
  out: React.ReactNode[],
  range: Range,
  charWidth: number,
  lineHeight: number,
  paddingLeft: number,
  paddingTop: number,
  layout: VisualLayout,
  cls: string,
  keyPrefix: string,
) {
  const { start, end } = range;
  for (const vl of layout.lines) {
    if (vl.line < start.line || vl.line > end.line) continue;
    const lineStart = vl.startCol;
    const lineEnd = vl.endCol;
    const sCol = vl.line === start.line ? Math.max(start.col, lineStart) : lineStart;
    const eCol = vl.line === end.line ? Math.min(end.col, lineEnd) : lineEnd;
    if (eCol < lineStart || sCol > lineEnd || eCol < sCol) continue;
    const sPoint = layout.positionToPoint({ line: vl.line, col: sCol });
    const ePoint = layout.positionToPoint({ line: vl.line, col: eCol });
    const left = paddingLeft + sPoint.x * charWidth;
    const width = Math.max(2, Math.max(ePoint.x - sPoint.x, 1) * charWidth);
    out.push(
      <span
        key={`${keyPrefix}_${vl.visualIndex}`}
        className={`ade-${cls}`}
        style={{
          position: "absolute",
          top: paddingTop + vl.top,
          left,
          width,
          height: lineHeight,
        }}
      />,
    );
  }
}

export const SelectionLayer = memo(SelectionLayerInner);
