/**
 * Tokenizador linha-a-linha. Mantém estado mínimo entre linhas pra suportar
 * comentários de bloco multi-linha. Fast path: linhas sem caracteres especiais
 * retornam um único token "plain".
 */

import { LANGUAGES, type LangSpec, type TokenType } from "./languages";

export type Token = {
  type: TokenType;
  start: number;
  end: number;
};

export type LineState = {
  /** 0 = normal; 1 = dentro de bloco de comentário; 2 = dentro de template string `` */
  ctx: 0 | 1 | 2;
};

export const INITIAL_STATE: LineState = { ctx: 0 };

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;
const NUMBER_RE =
  /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)n?/y;
const WS_RE = /\s+/y;

export function tokenizeLine(
  line: string,
  langId: string,
  prevState: LineState,
): { tokens: Token[]; state: LineState } {
  const lang: LangSpec = LANGUAGES[langId] ?? LANGUAGES.plaintext;
  const jsxMode = langId === "typescriptreact" || langId === "javascriptreact";
  const tokens: Token[] = [];
  let i = 0;
  let ctx = prevState.ctx;

  // Fast path: linha vazia
  if (line.length === 0) {
    return { tokens, state: { ctx } };
  }

  // Continuação de bloco-comentário aberto em linha anterior
  if (ctx === 1 && lang.blockComment) {
    const close = lang.blockComment[1];
    const idx = line.indexOf(close);
    if (idx === -1) {
      tokens.push({ type: "comment", start: 0, end: line.length });
      return { tokens, state: { ctx: 1 } };
    }
    tokens.push({ type: "comment", start: 0, end: idx + close.length });
    i = idx + close.length;
    ctx = 0;
  }

  // Continuação de template string ` ... ` (TS/JS/Go)
  if (ctx === 2) {
    const idx = line.indexOf("`");
    if (idx === -1) {
      tokens.push({ type: "string", start: 0, end: line.length });
      return { tokens, state: { ctx: 2 } };
    }
    tokens.push({ type: "string", start: 0, end: idx + 1 });
    i = idx + 1;
    ctx = 0;
  }

  while (i < line.length) {
    const c = line[i];

    if (jsxMode && (c === "<" || c === ">")) {
      const parsed = tryTokenizeJsx(line, i, tokens);
      if (parsed > i) {
        i = parsed;
        continue;
      }
    }

    // whitespace — pulo, sem token (renderizado como plain por default)
    WS_RE.lastIndex = i;
    if (WS_RE.test(line)) {
      i = WS_RE.lastIndex;
      continue;
    }

    // line comment
    if (lang.lineComment && line.startsWith(lang.lineComment, i)) {
      tokens.push({ type: "comment", start: i, end: line.length });
      i = line.length;
      break;
    }

    // block comment
    if (lang.blockComment && line.startsWith(lang.blockComment[0], i)) {
      const close = lang.blockComment[1];
      const idx = line.indexOf(close, i + lang.blockComment[0].length);
      if (idx === -1) {
        tokens.push({ type: "comment", start: i, end: line.length });
        ctx = 1;
        i = line.length;
        break;
      }
      tokens.push({ type: "comment", start: i, end: idx + close.length });
      i = idx + close.length;
      continue;
    }

    // string
    if (lang.stringDelims && lang.stringDelims.includes(c)) {
      const start = i;
      const delim = c;
      i++;
      let closed = false;
      while (i < line.length) {
        const ch = line[i];
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === delim) {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      tokens.push({ type: "string", start, end: i });
      if (!closed && delim === "`") {
        ctx = 2;
      }
      continue;
    }

    // número
    NUMBER_RE.lastIndex = i;
    const numMatch = NUMBER_RE.exec(line);
    if (numMatch && numMatch.index === i) {
      tokens.push({ type: "number", start: i, end: i + numMatch[0].length });
      i += numMatch[0].length;
      continue;
    }

    // identificador
    IDENT_RE.lastIndex = i;
    const idMatch = IDENT_RE.exec(line);
    if (idMatch && idMatch.index === i) {
      const word = idMatch[0];
      const wordEnd = i + word.length;
      // Look-ahead: pula whitespace para decidir contexto.
      let next = wordEnd;
      while (next < line.length && (line[next] === " " || line[next] === "\t")) next++;
      const followChar = line[next];

      // Look-back: último keyword na mesma linha, atravessando apenas
      // comentários/pontuação. Cap em 8 iters pra garantir linearidade.
      let prevKeyword: string | null = null;
      const lookBackLimit = Math.max(0, tokens.length - 8);
      for (let k = tokens.length - 1; k >= lookBackLimit; k--) {
        const t = tokens[k];
        if (t.type === "keyword") {
          prevKeyword = line.slice(t.start, t.end);
          break;
        }
        if (t.type !== "comment" && t.type !== "punctuation") break;
      }
      // Pontuação imediata anterior (antes deste ident, ignorando whitespace).
      let immPrev: string | null = null;
      for (let k = i - 1; k >= 0; k--) {
        const c = line[k];
        if (c === " " || c === "\t") continue;
        immPrev = c;
        break;
      }

      let type: TokenType = "plain";

      // 1. Reserved words primeiro.
      if (lang.keywords.has(word)) type = "keyword";
      else if (lang.constants?.has(word)) type = "constant";
      else if (lang.types?.has(word)) type = "type";
      else if (lang.builtins?.has(word)) {
        type = followChar === "(" ? "function" : "namespace";
      }
      // 2. Promoção por look-back: o último keyword "interessante" determina
      //    o que este identificador é.
      else if (prevKeyword && lang.variableDeclKw?.has(prevKeyword) && immPrev !== ".") {
        type = "variable";
      } else if (prevKeyword && lang.functionDeclKw?.has(prevKeyword) && immPrev !== ".") {
        // `func foo` → foo é function
        // mas em Go: `func (r *Receiver) Method()` — o ident depois de `func`
        // pode ser `(` (receiver). Tratado pelo immPrev: se for `(` ou `*`, vira plain/type.
        type = "function";
      } else if (prevKeyword && lang.typeDeclKw?.has(prevKeyword) && immPrev !== ".") {
        type = "type";
      } else if (prevKeyword && lang.namespaceKw?.has(prevKeyword)) {
        type = "namespace";
      }
      // 3. Member access: x.y → y vira property/function.
      else if (immPrev === ".") {
        type = followChar === "(" ? "function" : "property";
      }
      // 4. Heurística de capital case: PascalCase → type, UPPER_SNAKE → constant.
      else if (lang.upperSnakeIsConstant && /^[A-Z][A-Z0-9_]*$/.test(word) && word.length > 1) {
        type = "constant";
      } else if (lang.pascalCaseIsType && /^[A-Z]/.test(word) && followChar !== "(") {
        type = "type";
      }
      // 5. Function call.
      else if (followChar === "(") {
        type = "function";
      }
      // 6. Decorador @foo (TS, Python).
      else if (immPrev === "@") {
        type = "decorator";
      }

      if (type !== "plain") {
        tokens.push({ type, start: i, end: i + word.length });
      }
      i += word.length;
      continue;
    }

    if (line.startsWith("=>", i) || line.startsWith("===", i) || line.startsWith("!==", i)) {
      tokens.push({ type: "operator", start: i, end: i + (line[i + 2] === "=" ? 3 : 2) });
      i += line[i + 2] === "=" ? 3 : 2;
      continue;
    }
    if (/[=+\-*/%&|!?:]/.test(c)) {
      tokens.push({ type: "operator", start: i, end: i + 1 });
      i++;
      continue;
    }

    // operadores e pontuação — agrupados como punctuation
    if ("[]{}();,.<>".includes(c)) {
      tokens.push({ type: "punctuation", start: i, end: i + 1 });
      i++;
      continue;
    }

    // caractere desconhecido — avança
    i++;
  }

  return { tokens, state: { ctx } };
}

function tryTokenizeJsx(line: string, start: number, out: Token[]): number {
  if (line[start] !== "<") return start;
  const next = line[start + 1];
  if (!next || !/[A-Za-z/>]/.test(next)) return start;

  let i = start;
  out.push({ type: "punctuation", start: i, end: i + 1 });
  i++;

  if (line[i] === "/") {
    out.push({ type: "punctuation", start: i, end: i + 1 });
    i++;
  }

  i = skipWs(line, i);
  const tagStart = i;
  while (i < line.length && /[A-Za-z0-9_$:.-]/.test(line[i])) i++;
  if (i > tagStart) {
    const tag = line.slice(tagStart, i);
    out.push({ type: /^[A-Z]/.test(tag) ? "type" : "tag", start: tagStart, end: i });
  }

  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'") {
      const end = readQuoted(line, i);
      out.push({ type: "string", start: i, end });
      i = end;
      continue;
    }
    if (c === "{") {
      out.push({ type: "punctuation", start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === "}") {
      out.push({ type: "punctuation", start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === "/" && line[i + 1] === ">") {
      out.push({ type: "punctuation", start: i, end: i + 2 });
      return i + 2;
    }
    if (c === ">") {
      out.push({ type: "punctuation", start: i, end: i + 1 });
      return i + 1;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const attrStart = i;
      while (i < line.length && /[A-Za-z0-9_$:.-]/.test(line[i])) i++;
      out.push({ type: "attribute", start: attrStart, end: i });
      continue;
    }
    if (c === "=") {
      out.push({ type: "operator", start: i, end: i + 1 });
      i++;
      continue;
    }
    out.push({ type: "punctuation", start: i, end: i + 1 });
    i++;
  }
  return i;
}

function skipWs(line: string, i: number): number {
  while (i < line.length && /\s/.test(line[i])) i++;
  return i;
}

function readQuoted(line: string, start: number): number {
  const quote = line[start];
  let i = start + 1;
  while (i < line.length) {
    if (line[i] === "\\") {
      i += 2;
      continue;
    }
    if (line[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/** Cache simples por buffer: lineState[i] = estado APÓS tokenizar linha i. */
export class TokenizerCache {
  private states: LineState[] = [INITIAL_STATE];
  private tokens: Token[][] = [];

  invalidateFrom(line: number) {
    this.states.length = Math.min(this.states.length, line + 1);
    this.tokens.length = Math.min(this.tokens.length, line);
  }

  reset() {
    this.states = [INITIAL_STATE];
    this.tokens = [];
  }

  tokenizeUpTo(
    getLine: (i: number) => string,
    lineCount: number,
    target: number,
    langId: string,
  ): void {
    const limit = Math.min(target + 1, lineCount);
    for (let i = this.tokens.length; i < limit; i++) {
      const { tokens, state } = tokenizeLine(getLine(i), langId, this.states[i] ?? INITIAL_STATE);
      this.tokens[i] = tokens;
      this.states[i + 1] = state;
    }
  }

  getLineTokens(line: number): Token[] {
    return this.tokens[line] ?? [];
  }
}
