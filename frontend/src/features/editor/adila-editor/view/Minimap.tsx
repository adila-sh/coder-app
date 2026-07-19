/**
 * Minimap — duas camadas separadas pra evitar repaint do canvas em cada scroll:
 *
 *  - <canvas> estático: contém os tokens. Repinta APENAS quando o buffer muda
 *    (bufferVersion) ou as dimensões mudam. Scroll não invalida.
 *  - <div> overlay: o retângulo do viewport. Posicionado via `top` style; o
 *    browser compõe via GPU sem repaint.
 *
 * Com essa separação, dragar o minimap num arquivo de 10k linhas mantém 60+ fps
 * porque o trabalho real (10k fillRects) acontece uma vez na montagem, não a
 * cada movimento do mouse.
 */

import { memo, useEffect, useLayoutEffect, useRef } from "react";
import type { LineBuffer } from "../buffer/TextBuffer";
import type { Token, TokenizerCache } from "../syntax/tokenize";
import type { TokenType } from "../syntax/languages";

const MINI_LH = 3;
const MINI_CHAR_W = 1;
const PAD_RIGHT = 4;

const TOKEN_COLOR: Record<TokenType, string> = {
  plain: "rgba(180, 180, 200, 0.35)",
  keyword: "rgba(200, 130, 230, 0.85)",
  string: "rgba(120, 220, 140, 0.75)",
  number: "rgba(255, 180, 80, 0.75)",
  comment: "rgba(120, 180, 130, 0.55)",
  operator: "rgba(180, 180, 200, 0.5)",
  punctuation: "rgba(160, 160, 180, 0.5)",
  variable: "rgba(180, 180, 200, 0.55)",
  function: "rgba(120, 200, 255, 0.85)",
  type: "rgba(110, 220, 220, 0.8)",
  constant: "rgba(255, 160, 90, 0.85)",
  tag: "rgba(255, 130, 130, 0.85)",
  attribute: "rgba(255, 220, 120, 0.8)",
  namespace: "rgba(240, 200, 130, 0.8)",
  parameter: "rgba(255, 170, 150, 0.8)",
  property: "rgba(140, 200, 240, 0.8)",
  decorator: "rgba(255, 220, 100, 0.85)",
  regexp: "rgba(255, 130, 130, 0.85)",
};

type Props = {
  buffer: LineBuffer;
  tokenCache: TokenizerCache;
  langId: string;
  bufferVersion: number;
  width: number;
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
  editorLineHeight: number;
  onScrollTo: (scrollTop: number) => void;
};

function MinimapInner({
  buffer,
  tokenCache,
  langId,
  bufferVersion,
  width,
  scrollTop,
  viewportHeight,
  contentHeight,
  editorLineHeight,
  onScrollTo,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ active: boolean } | null>(null);

  const lineCount = buffer.getLineCount();
  const minimapHeight = viewportHeight;

  // visualLineH = quanto cada linha ocupa no minimap.
  //   - arquivo pequeno (cabe inteiro): linha = MINI_LH px → o código não
  //     preenche todo o canvas, sobrando espaço vazio embaixo.
  //   - arquivo grande: comprime pra encaixar todas as linhas em minimapHeight.
  // Importante: clicar no espaço vazio não pode pular pro final — o
  // mapeamento usa usedHeight (altura real ocupada por código), não
  // minimapHeight.
  const idealHeight = lineCount * MINI_LH;
  const visualLineH =
    idealHeight <= minimapHeight ? MINI_LH : minimapHeight / Math.max(1, lineCount);
  const usedHeight = Math.min(minimapHeight, lineCount * visualLineH);
  // Razão minimap-px → scroller-px. Vale tanto para overlay (scroll → top no
  // minimap) quanto para click (top no minimap → scroll).
  const minimapToScroller = visualLineH > 0 ? editorLineHeight / visualLineH : 1;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);

  // Pinta os tokens — só quando buffer/dim mudam. NÃO depende de scrollTop.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(minimapHeight * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${minimapHeight}px`;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, minimapHeight);

    // Garante que tokens da janela visível do minimap estejam computados.
    // Em vez de tokenizar O ARQUIVO INTEIRO, tokeniza só até a última linha
    // que cabe no canvas (arquivos grandes: a maioria não vira pixel mesmo).
    const maxLineDrawn = Math.min(lineCount - 1, Math.ceil(minimapHeight / visualLineH));
    tokenCache.tokenizeUpTo((i) => buffer.getLine(i), lineCount, maxLineDrawn, langId);

    const maxX = width - PAD_RIGHT;
    for (let i = 0; i <= maxLineDrawn; i++) {
      const y = Math.floor(i * visualLineH);
      if (y > minimapHeight) break;
      const text = buffer.getLine(i);
      if (text.length === 0) continue;
      drawLine(ctx, text, tokenCache.getLineTokens(i), y, Math.max(1, visualLineH * 0.85), maxX);
    }
  }, [buffer, bufferVersion, tokenCache, langId, lineCount, width, minimapHeight, visualLineH]);

  // Viewport overlay: CSS only, atualizado via ref pra não disparar React render.
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const top = minimapToScroller > 0 ? scrollTop / minimapToScroller : 0;
    const h = Math.max(
      20,
      minimapToScroller > 0 ? viewportHeight / minimapToScroller : viewportHeight,
    );
    el.style.transform = `translateY(${top}px)`;
    el.style.height = `${h}px`;
  }, [scrollTop, viewportHeight, minimapToScroller]);

  function pointerToScroll(clientY: number): number {
    const wrap = wrapRef.current;
    if (!wrap) return 0;
    const rect = wrap.getBoundingClientRect();
    // Clampa o Y ao range "ocupado" — clique abaixo do código vira clique no
    // último pixel de código, não no fim do scroller.
    const localY = Math.max(0, Math.min(usedHeight, clientY - rect.top));
    const target = localY * minimapToScroller - viewportHeight / 2;
    return Math.max(0, Math.min(maxScroll, target));
  }

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onScrollTo(pointerToScroll(e.clientY));
    dragRef.current = { active: true };

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      if (!dragRef.current?.active) return;
      onScrollTo(pointerToScroll(ev.clientY));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = Math.max(0, Math.min(maxScroll, scrollTop + e.deltaY));
    onScrollTo(next);
  }

  function stopEditorMouseHandling(e: React.MouseEvent) {
    e.stopPropagation();
  }

  return (
    <div
      ref={wrapRef}
      className="ade-minimap"
      onClick={stopEditorMouseHandling}
      onMouseDown={onMouseDown}
      onMouseMove={stopEditorMouseHandling}
      onMouseUp={stopEditorMouseHandling}
      onWheel={onWheel}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width,
        height: viewportHeight,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <canvas ref={canvasRef} />
      <div
        ref={overlayRef}
        className="ade-minimap-viewport-rect"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 20,
          willChange: "transform",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  tokens: Token[],
  y: number,
  barH: number,
  maxX: number,
) {
  if (tokens.length === 0) {
    let firstNonWs = 0;
    while (firstNonWs < text.length && /\s/.test(text[firstNonWs])) firstNonWs++;
    const visibleEnd = Math.min(text.length, maxX / MINI_CHAR_W);
    if (visibleEnd <= firstNonWs) return;
    ctx.fillStyle = TOKEN_COLOR.plain;
    ctx.fillRect(firstNonWs * MINI_CHAR_W, y, (visibleEnd - firstNonWs) * MINI_CHAR_W, barH);
    return;
  }
  for (const t of tokens) {
    const x = t.start * MINI_CHAR_W;
    if (x > maxX) break;
    const w = Math.min(maxX - x, (t.end - t.start) * MINI_CHAR_W);
    if (w <= 0) continue;
    ctx.fillStyle = TOKEN_COLOR[t.type];
    ctx.fillRect(x, y, w, barH);
  }
}

export const Minimap = memo(MinimapInner);
