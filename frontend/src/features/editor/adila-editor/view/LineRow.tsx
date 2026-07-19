import { memo } from "react";
import type { Token } from "../syntax/tokenize";
import { TOKEN_CLASS } from "../syntax/theme";

type Props = {
  text: string;
  tokens: Token[];
  startCol?: number;
  tabSize?: number;
};

/**
 * Renderiza uma linha em spans tokenizados. Memo + chaves estáveis (start)
 * mantém o React eficiente quando linhas vizinhas re-renderizam.
 */
function LineRowInner({ text, tokens, startCol = 0, tabSize = 4 }: Props) {
  const renderText = (value: string, baseVisualCol: number) => {
    let visual = baseVisualCol;
    let out = "";
    for (const ch of value) {
      if (ch === "\t") {
        const width = tabSize - (visual % tabSize);
        out += " ".repeat(width);
        visual += width;
      } else {
        out += ch;
        visual++;
      }
    }
    return out;
  };
  const localTokens =
    startCol > 0
      ? tokens
          .map((t) => ({ ...t, start: t.start - startCol, end: t.end - startCol }))
          .filter((t) => t.start < text.length && t.end > 0)
          .map((t) => ({ ...t, start: Math.max(0, t.start), end: Math.min(text.length, t.end) }))
      : tokens;
  if (tokens.length === 0) {
    return <span className="tk-plain">{text ? renderText(text, 0) : " "}</span>;
  }
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < localTokens.length; i++) {
    const t = localTokens[i];
    if (t.start > cursor) {
      out.push(
        <span key={`p${cursor}`} className="tk-plain">
          {renderText(text.slice(cursor, t.start), cursor)}
        </span>,
      );
    }
    out.push(
      <span key={`t${t.start}`} className={TOKEN_CLASS[t.type]}>
        {renderText(text.slice(t.start, t.end), t.start)}
      </span>,
    );
    cursor = t.end;
  }
  if (cursor < text.length) {
    out.push(
      <span key={`p${cursor}`} className="tk-plain">
        {renderText(text.slice(cursor), cursor)}
      </span>,
    );
  }
  return <>{out}</>;
}

export const LineRow = memo(
  LineRowInner,
  (a, b) =>
    a.text === b.text &&
    a.tokens === b.tokens &&
    a.startCol === b.startCol &&
    a.tabSize === b.tabSize,
);
