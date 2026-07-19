export type Position = { line: number; col: number };
export type Range = { start: Position; end: Position };

export function posEq(a: Position, b: Position): boolean {
  return a.line === b.line && a.col === b.col;
}

export function posCmp(a: Position, b: Position): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.col - b.col;
}

export function posMin(a: Position, b: Position): Position {
  return posCmp(a, b) <= 0 ? a : b;
}

export function posMax(a: Position, b: Position): Position {
  return posCmp(a, b) >= 0 ? a : b;
}

export function normalizeRange(r: Range): Range {
  return posCmp(r.start, r.end) <= 0 ? r : { start: r.end, end: r.start };
}

export function rangeIsEmpty(r: Range): boolean {
  return posEq(r.start, r.end);
}
