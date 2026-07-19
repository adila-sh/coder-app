/**
 * AdilaEditor — entrypoint do novo editor. Drop-in replacement do Monaco
 * com a mesma assinatura usada por PaneTree.
 *
 * Mantém um store por instância (criado via useState lazy). O `content` é
 * tratado como fonte da verdade externa: quando muda fora de uma edição
 * interna, sincroniza o buffer (suporta hot-reload e reset por path).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type * as proto from "vscode-languageserver-protocol";
import { EventsOn } from "../../../../wailsjs/runtime/runtime";
import { useEditorConfig } from "../useEditorConfig";
import type { EditorMarker } from "../ProblemsPanel";
import { detectLanguage } from "./syntax/languages";
import { createEditorStore } from "./state/editorStore";
import { EditorView } from "./view/EditorView";
import { FindPanel } from "./search/FindPanel";
import { AdilaEditorContextMenu } from "./AdilaEditorContextMenu";
import { useAdilaLSP } from "./lsp/useAdilaLSP";
import "./adila-editor.css";

type Props = {
  path: string;
  content: string;
  rootUri?: string;
  onChange: (value: string) => void;
  onCursorChange?: (line: number, col: number) => void;
  onMarkersChange?: (path: string, markers: EditorMarker[]) => void;
};

export function AdilaEditor({
  path,
  content,
  rootUri,
  onChange,
  onCursorChange,
  onMarkersChange,
}: Props) {
  const { config: cfg } = useEditorConfig();
  const langId = detectLanguage(path);

  // Store por instância. Lazy init com o conteúdo inicial.
  const [store] = useState(() => createEditorStore(content, langId));
  const [findOpen, setFindOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<proto.Diagnostic[]>([]);

  const lspApi = useAdilaLSP({
    store,
    path,
    lang: langId,
    rootUri,
    onMarkersChange,
    onDiagnostics: setDiagnostics,
  });

  // Sincroniza language quando o path muda.
  useEffect(() => {
    store.getState().setLanguage(langId);
  }, [langId, store]);

  // Sincroniza content externo. Só aplica setValue se o valor REALMENTE
  // mudou em relação ao buffer interno — caso contrário, edições internas
  // são perdidas em loops React.
  const lastInternalRef = useRef(content);
  useEffect(() => {
    const current = store.getState().getValue();
    if (content === current) {
      lastInternalRef.current = content;
      return;
    }
    // Mudança externa: hot reload ou troca de tab para mesmo path.
    store.getState().setValue(content);
    lastInternalRef.current = content;
  }, [content, store]);

  // Wrapper de onChange que rastreia o último valor interno.
  const handleChange = (v: string) => {
    lastInternalRef.current = v;
    onChange(v);
  };

  // Goto line via event bus (mantém compat com o resto da app).
  useEffect(() => {
    return EventsOn("editor.gotoLine", (payload: unknown) => {
      const p = payload as { line?: number; column?: number } | null;
      const line = (p?.line ?? 1) - 1;
      const col = (p?.column ?? 1) - 1;
      const buf = store.getState().buffer;
      const lc = Math.max(0, Math.min(line, buf.getLineCount() - 1));
      const cc = Math.max(0, Math.min(col, buf.getLineLength(lc)));
      store
        .getState()
        .setCursors([
          { pos: { line: lc, col: cc }, anchor: { line: lc, col: cc }, desiredCol: cc },
        ]);
    });
  }, [store]);

  // Atalho global Ctrl+F abre find — mas só quando este editor está focado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        // Verifica se foco está dentro de algum AdilaEditor.
        const target = e.target as HTMLElement | null;
        if (target?.closest(".ade-root")) {
          e.preventDefault();
          setFindOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lineHeight = useMemo(() => Math.round(cfg.fontSize * 1.5), [cfg.fontSize]);

  return (
    <div className="ade-host" style={{ position: "relative", width: "100%", height: "100%" }}>
      <FindPanel store={store} open={findOpen} onClose={() => setFindOpen(false)} />
      <AdilaEditorContextMenu store={store} filePath={path} lspApi={lspApi}>
        <EditorView
          store={store}
          filePath={path}
          fontFamily={cfg.fontFamily}
          fontSize={cfg.fontSize}
          lineHeight={lineHeight}
          showLineNumbers={cfg.lineNumbers !== "off"}
          relativeLineNumbers={cfg.lineNumbers === "relative"}
          highlightCurrentLine={cfg.renderLineHighlight !== "none"}
          wordWrap={cfg.wordWrap !== "off"}
          tabSize={cfg.tabSize}
          caretBlink={cfg.cursorBlinking !== "solid"}
          smoothScroll={cfg.smoothScrolling}
          showMinimap={cfg.minimap}
          readOnly={false}
          diagnostics={diagnostics}
          lspApi={lspApi}
          onCursorChange={onCursorChange}
          onChange={handleChange}
        />
      </AdilaEditorContextMenu>
    </div>
  );
}
