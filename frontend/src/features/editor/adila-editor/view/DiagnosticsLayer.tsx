import { memo } from "react";
import type * as proto from "vscode-languageserver-protocol";
import type { VisualLayout } from "./layout";

type Props = {
  diagnostics: proto.Diagnostic[];
  charWidth: number;
  lineHeight: number;
  paddingLeft: number;
  paddingTop: number;
  firstVisible: number;
  lastVisible: number;
  onOpenCodeActions?: (line: number, col: number) => void;
  layout: VisualLayout;
};

/** Renderiza squiggle underlines pra cada diagnostic via SVG inline. */
function DiagnosticsLayerInner({
  diagnostics,
  charWidth,
  lineHeight,
  paddingLeft,
  paddingTop,
  firstVisible,
  lastVisible,
  onOpenCodeActions,
  layout,
}: Props) {
  const items: React.ReactNode[] = [];

  for (let i = 0; i < diagnostics.length; i++) {
    const d = diagnostics[i];
    const startLine = d.range.start.line;
    const endLine = d.range.end.line;
    if (endLine < firstVisible || startLine > lastVisible) continue;

    const firstLine = Math.max(startLine, firstVisible);
    const lastLine = Math.min(endLine, lastVisible);

    for (let line = firstLine; line <= lastLine; line++) {
      const sCol = line === startLine ? d.range.start.character : 0;
      const eCol = line === endLine ? d.range.end.character : Math.max(sCol + 1, sCol + 80);
      const start = layout.positionToPoint({ line, col: sCol });
      const end = layout.positionToPoint({ line, col: eCol });
      const width = Math.max(charWidth, (end.x - start.x) * charWidth);
      const left = paddingLeft + start.x * charWidth;
      const top = paddingTop + start.y + lineHeight - 4;

      const color = severityColor(d.severity);
      items.push(
        <div
          key={`d${i}_${line}`}
          title={`${severityLabel(d.severity)}: ${d.message}${d.source ? `\n${d.source}` : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenCodeActions?.(d.range.start.line, d.range.start.character);
          }}
          style={{
            position: "absolute",
            top,
            left,
            width,
            height: 4,
            pointerEvents: "auto",
            zIndex: 2,
            cursor: onOpenCodeActions ? "pointer" : "default",
            backgroundImage: `url("data:image/svg+xml;utf8,${squiggleSvg(color)}")`,
            backgroundRepeat: "repeat-x",
          }}
        />,
      );
    }
  }

  return (
    <div
      className="ade-diagnostics-layer"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}
    >
      {items}
    </div>
  );
}

function severityColor(sev: number | undefined): string {
  // 1=Error 2=Warning 3=Info 4=Hint (LSP convention)
  if (sev === 1) return "#f48771";
  if (sev === 2) return "#cca700";
  if (sev === 3) return "#75beff";
  return "#888";
}

function severityLabel(sev: number | undefined): string {
  if (sev === 1) return "Erro";
  if (sev === 2) return "Aviso";
  if (sev === 3) return "Informação";
  return "Dica";
}

function squiggleSvg(color: string): string {
  // Onda em zig-zag de 6x4. Encoded inline pra evitar fetch.
  const c = encodeURIComponent(color);
  return `<svg xmlns='http://www.w3.org/2000/svg' width='6' height='4' viewBox='0 0 6 4'><path d='M0 3 Q1.5 0 3 3 T6 3' fill='none' stroke='${c}' stroke-width='1'/></svg>`;
}

export const DiagnosticsLayer = memo(DiagnosticsLayerInner);
