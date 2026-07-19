/**
 * Benchmarks do AdilaEditor — buffer / tokenizer / cursor / pipeline de edit.
 *
 * Roda com:  npm run bench -- adila-editor
 *
 * Métricas relevantes:
 * - hz (operações por segundo) — quanto maior, melhor
 * - mean / p99 — latência típica vs cauda
 *
 * Os números baseline em uma máquina x86_64 moderna ficam em torno de:
 *   - getValue 10k linhas:   ~2k hz  (ms range é o que interessa pra typing)
 *   - tokenize 1k linhas:    ~10k hz (linha-a-linha cacheado)
 *   - insert no meio 10k:    ~100k hz
 *   - movement por palavra:  ~1M hz
 */

import { bench, describe } from "vitest";
import { LineBuffer } from "../features/editor/adila-editor/buffer/TextBuffer";
import { type Position } from "../features/editor/adila-editor/buffer/types";
import {
  INITIAL_STATE,
  TokenizerCache,
  tokenizeLine,
} from "../features/editor/adila-editor/syntax/tokenize";
import {
  moveLeft,
  moveRight,
  moveWordLeft,
  moveWordRight,
} from "../features/editor/adila-editor/cursor/movement";
import { createEditorStore } from "../features/editor/adila-editor/state/editorStore";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const TS_LINE = `function compute<T extends Record<string, number>>(items: T[], fn: (x: T) => number): number {`;
const TS_BODY = [
  `  // Reduce em paralelo — cada chunk vira uma Promise.`,
  `  const chunks = chunkBy(items, 256);`,
  `  let total = 0;`,
  `  for (const chunk of chunks) {`,
  `    total += chunk.reduce((acc, x) => acc + fn(x), 0);`,
  `  }`,
  `  return total;`,
  `}`,
  ``,
];

function makeSource(lines: number): string {
  // Mistura uma linha "longa" com 8 linhas variadas pra simular código real.
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    const mod = i % (TS_BODY.length + 1);
    out.push(mod === 0 ? TS_LINE : TS_BODY[mod - 1]);
  }
  return out.join("\n");
}

const SRC_1K = makeSource(1000);
const SRC_10K = makeSource(10_000);
const SRC_100K = makeSource(100_000);

// ─── Buffer ───────────────────────────────────────────────────────────────

describe("buffer — getValue (rebuild string)", () => {
  const buf1k = new LineBuffer(SRC_1K);
  const buf10k = new LineBuffer(SRC_10K);
  const buf100k = new LineBuffer(SRC_100K);
  bench("1k linhas", () => {
    buf1k.getValue();
  });
  bench("10k linhas", () => {
    buf10k.getValue();
  });
  bench("100k linhas", () => {
    buf100k.getValue();
  });
});

describe("buffer — getLine (random access)", () => {
  const buf = new LineBuffer(SRC_10K);
  bench("10k linhas — 1k acessos aleatórios", () => {
    for (let i = 0; i < 1000; i++) {
      buf.getLine(Math.floor(Math.random() * 10_000));
    }
  });
});

describe("buffer — insert no meio", () => {
  bench("10k linhas — insert single char", () => {
    const buf = new LineBuffer(SRC_10K);
    const pos: Position = { line: 5000, col: 10 };
    buf.insert(pos, "x");
  });
  bench("10k linhas — insert linha nova", () => {
    const buf = new LineBuffer(SRC_10K);
    const pos: Position = { line: 5000, col: 0 };
    buf.insert(pos, "const newLine = 42;\n");
  });
});

describe("buffer — remove range", () => {
  bench("10k linhas — remove 1 char", () => {
    const buf = new LineBuffer(SRC_10K);
    buf.remove({ start: { line: 5000, col: 5 }, end: { line: 5000, col: 6 } });
  });
  bench("10k linhas — remove 100 linhas contíguas", () => {
    const buf = new LineBuffer(SRC_10K);
    buf.remove({ start: { line: 4900, col: 0 }, end: { line: 5000, col: 0 } });
  });
});

describe("buffer — offsetAt / positionAt round-trip", () => {
  const buf = new LineBuffer(SRC_10K);
  bench("10k linhas — 100 round-trips", () => {
    for (let i = 0; i < 100; i++) {
      const off = buf.offsetAt({ line: i * 100, col: 0 });
      buf.positionAt(off);
    }
  });
});

// ─── Tokenizer ────────────────────────────────────────────────────────────

describe("tokenize — uma linha", () => {
  bench("typescript — linha simples", () => {
    tokenizeLine(`const x = 42;`, "typescript", INITIAL_STATE);
  });
  bench("typescript — linha complexa (genéricos + arrow)", () => {
    tokenizeLine(TS_LINE, "typescript", INITIAL_STATE);
  });
  bench("typescript — string longa", () => {
    tokenizeLine(`const s = "${"a".repeat(200)}";`, "typescript", INITIAL_STATE);
  });
  bench("typescript — comentário", () => {
    tokenizeLine(
      `// just a regular line comment with words and numbers 42`,
      "typescript",
      INITIAL_STATE,
    );
  });
});

describe("tokenize — arquivo inteiro (cold cache)", () => {
  bench("1k linhas", () => {
    const buf = new LineBuffer(SRC_1K);
    const cache = new TokenizerCache();
    cache.tokenizeUpTo(
      (i) => buf.getLine(i),
      buf.getLineCount(),
      buf.getLineCount() - 1,
      "typescript",
    );
  });
  bench("10k linhas", () => {
    const buf = new LineBuffer(SRC_10K);
    const cache = new TokenizerCache();
    cache.tokenizeUpTo(
      (i) => buf.getLine(i),
      buf.getLineCount(),
      buf.getLineCount() - 1,
      "typescript",
    );
  });
});

describe("tokenize — viewport quente (cache hit)", () => {
  // Simula scroll: cache já populado, só pede linhas visíveis novamente.
  const buf = new LineBuffer(SRC_10K);
  const cache = new TokenizerCache();
  cache.tokenizeUpTo(
    (i) => buf.getLine(i),
    buf.getLineCount(),
    buf.getLineCount() - 1,
    "typescript",
  );
  bench("10k linhas — 50 linhas visíveis", () => {
    cache.tokenizeUpTo((i) => buf.getLine(i), buf.getLineCount(), 50, "typescript");
  });
});

// ─── Cursor movement ──────────────────────────────────────────────────────

describe("cursor — movement", () => {
  const buf = new LineBuffer(SRC_10K);
  const start: Position = { line: 5000, col: 20 };

  bench("moveLeft × 1000", () => {
    let p = start;
    for (let i = 0; i < 1000; i++) p = moveLeft(buf, p);
  });
  bench("moveRight × 1000", () => {
    let p = start;
    for (let i = 0; i < 1000; i++) p = moveRight(buf, p);
  });
  bench("moveWordLeft × 1000", () => {
    let p = start;
    for (let i = 0; i < 1000; i++) p = moveWordLeft(buf, p);
  });
  bench("moveWordRight × 1000", () => {
    let p = start;
    for (let i = 0; i < 1000; i++) p = moveWordRight(buf, p);
  });
});

// ─── Edit cycle (store completo) ──────────────────────────────────────────

describe("editor store — typing simulation", () => {
  bench("10k linhas — 50 chars sequenciais (typing)", () => {
    const store = createEditorStore(SRC_10K, "typescript");
    // Posiciona no meio.
    store.getState().setCursors([
      {
        pos: { line: 5000, col: 0 },
        anchor: { line: 5000, col: 0 },
        desiredCol: 0,
      },
    ]);
    for (let i = 0; i < 50; i++) {
      store.getState().insertText("a");
    }
  });

  bench("10k linhas — backspace × 50", () => {
    const store = createEditorStore(SRC_10K, "typescript");
    store.getState().setCursors([
      {
        pos: { line: 5000, col: 30 },
        anchor: { line: 5000, col: 30 },
        desiredCol: 30,
      },
    ]);
    for (let i = 0; i < 50; i++) {
      store.getState().deleteSelectionOrChar("back");
    }
  });

  bench("10k linhas — undo × 10 após 10 edits", () => {
    const store = createEditorStore(SRC_10K, "typescript");
    store.getState().setCursors([
      {
        pos: { line: 5000, col: 0 },
        anchor: { line: 5000, col: 0 },
        desiredCol: 0,
      },
    ]);
    // 10 grupos de typing separados (intercala edição "diferente" pra forçar grupos).
    for (let i = 0; i < 10; i++) {
      store.getState().insertText("xxxx");
      store.getState().deleteSelectionOrChar("back");
    }
    for (let i = 0; i < 10; i++) {
      store.getState().undo();
    }
  });
});

describe("editor store — find computeMatches", () => {
  bench("10k linhas — needle pequeno", () => {
    const store = createEditorStore(SRC_10K, "typescript");
    store.getState().setFindQuery("const");
    store.getState().computeFindMatches();
  });
  bench("10k linhas — regex", () => {
    const store = createEditorStore(SRC_10K, "typescript");
    store.getState().setFindOptions({ findRegex: true });
    store.getState().setFindQuery("\\bfunction\\s+\\w+");
    store.getState().computeFindMatches();
  });
});
