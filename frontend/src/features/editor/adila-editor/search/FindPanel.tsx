import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { EditorStore } from "../state/editorStore";

type Props = {
  store: EditorStore;
  open: boolean;
  onClose: () => void;
};

export function FindPanel({ store, open, onClose }: Props) {
  const state = useStore(store);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  // Sempre que query/options/buffer mudarem, recomputa.
  useEffect(() => {
    if (open) state.computeFindMatches();
  }, [
    state.findQuery,
    state.findCaseSensitive,
    state.findWholeWord,
    state.findRegex,
    state.version,
    open,
  ]);

  if (!open) return null;

  const onFindKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) state.findPrev();
      else state.findNext();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "h" || e.key === "H")) {
      e.preventDefault();
      setReplaceOpen(true);
      requestAnimationFrame(() => replaceRef.current?.focus());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const onReplaceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.altKey) state.replaceAll();
      else state.replaceCurrent();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className={`ade-find-panel${replaceOpen ? " ade-find-replace-open" : ""}`}>
      <div className="ade-find-row">
        <button
          type="button"
          className={`ade-find-btn ade-find-toggle${replaceOpen ? " ade-active" : ""}`}
          onClick={() => setReplaceOpen((v) => !v)}
          title={replaceOpen ? "Ocultar substituir" : "Mostrar substituir"}
        >
          {replaceOpen ? "⌄" : "›"}
        </button>
        <input
          ref={inputRef}
          type="text"
          value={state.findQuery}
          onChange={(e) => state.setFindQuery(e.target.value)}
          onKeyDown={onFindKeyDown}
          placeholder="Buscar"
          className={`ade-find-input${state.findError ? " ade-find-input-error" : ""}`}
        />
        <span className="ade-find-count" title={state.findError ?? undefined}>
          {state.findError
            ? "Erro"
            : state.findMatches.length === 0
              ? "0"
              : `${state.findIndex + 1} / ${state.findMatches.length}`}
        </span>
        <button
          type="button"
          className={`ade-find-btn${state.findCaseSensitive ? " ade-active" : ""}`}
          title="Diferenciar maiúsculas/minúsculas"
          onClick={() => state.setFindOptions({ findCaseSensitive: !state.findCaseSensitive })}
        >
          Aa
        </button>
        <button
          type="button"
          className={`ade-find-btn${state.findWholeWord ? " ade-active" : ""}`}
          title="Palavra inteira"
          onClick={() => state.setFindOptions({ findWholeWord: !state.findWholeWord })}
        >
          ab
        </button>
        <button
          type="button"
          className={`ade-find-btn${state.findRegex ? " ade-active" : ""}`}
          title="Expressão regular"
          onClick={() => state.setFindOptions({ findRegex: !state.findRegex })}
        >
          .*
        </button>
        <button
          type="button"
          className="ade-find-btn"
          onClick={() => state.findPrev()}
          title="Anterior"
        >
          ↑
        </button>
        <button
          type="button"
          className="ade-find-btn"
          onClick={() => state.findNext()}
          title="Próximo"
        >
          ↓
        </button>
        <button type="button" className="ade-find-btn" onClick={onClose} title="Fechar">
          ×
        </button>
      </div>
      {replaceOpen && (
        <div className="ade-find-row">
          <span className="ade-find-spacer" />
          <input
            ref={replaceRef}
            type="text"
            value={state.findReplacement}
            onChange={(e) => state.setFindReplacement(e.target.value)}
            onKeyDown={onReplaceKeyDown}
            placeholder="Substituir"
            className="ade-find-input"
          />
          <button
            type="button"
            className="ade-find-action"
            onClick={() => state.replaceCurrent()}
            disabled={state.findMatches.length === 0}
            title="Substituir ocorrência atual"
          >
            Substituir
          </button>
          <button
            type="button"
            className="ade-find-action"
            onClick={() => state.replaceAll()}
            disabled={state.findMatches.length === 0}
            title="Substituir todas as ocorrências"
          >
            Todas
          </button>
        </div>
      )}
      {state.findError && <div className="ade-find-error">{state.findError}</div>}
    </div>
  );
}
