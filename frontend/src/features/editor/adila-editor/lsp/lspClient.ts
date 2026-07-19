/**
 * Cliente LSP para AdilaEditor — versão framework-agnostic do lspBridge.ts.
 *
 * Mantém uma conexão JSON-RPC por (lang, rootUri), compartilhada entre
 * abas. Não registra providers — expõe métodos que o consumidor (hook React)
 * chama: openDocument, changeDocument, closeDocument, hover, completion, etc.
 *
 * Diagnostics são entregues via callback registrado por documento.
 */

import { createMessageConnection } from "vscode-jsonrpc/browser";
import { toSocket } from "vscode-ws-jsonrpc";
import type * as proto from "vscode-languageserver-protocol";

type ConnectArgs = {
  lang: string;
  rootUri: string;
  port: number;
  onError: (msg: string, err?: unknown) => void;
};

const clients = new Map<string, Promise<AdilaLSPClient | null>>();

export function getOrCreateAdilaClient(args: ConnectArgs): Promise<AdilaLSPClient | null> {
  const key = `${args.lang}::${args.rootUri}`;
  let p = clients.get(key);
  if (!p) {
    p = AdilaLSPClient.connect(args).catch((err) => {
      args.onError(`Falha ao conectar LSP (${args.lang})`, err);
      clients.delete(key);
      return null;
    });
    clients.set(key, p);
  }
  return p;
}

type DiagnosticsHandler = (diagnostics: proto.Diagnostic[]) => void;
type WorkspaceEditHandler = (edit: proto.WorkspaceEdit) => boolean;

export class AdilaLSPClient {
  private connection: ReturnType<typeof createMessageConnection>;
  private lang: string;
  private rootUri: string;
  private serverCaps: proto.ServerCapabilities = {};
  private docs = new Map<string, { version: number }>();
  private diagnosticsHandlers = new Map<string, DiagnosticsHandler>();
  private workspaceEditHandler: WorkspaceEditHandler | null = null;
  private onError: ConnectArgs["onError"];
  private disposed = false;

  private constructor(
    lang: string,
    rootUri: string,
    connection: ReturnType<typeof createMessageConnection>,
    onError: ConnectArgs["onError"],
  ) {
    this.lang = lang;
    this.rootUri = rootUri;
    this.connection = connection;
    this.onError = onError;
  }

  get capabilities(): proto.ServerCapabilities {
    return this.serverCaps;
  }

  static async connect(args: ConnectArgs): Promise<AdilaLSPClient | null> {
    const { lang, rootUri, port, onError } = args;
    const url = `ws://127.0.0.1:${port}/lsp/${lang}?root=${encodeURIComponent(rootUri)}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`WebSocket falhou: ${url}`));
    });

    const socket = toSocket(ws);
    const reader = new (await import("vscode-ws-jsonrpc")).WebSocketMessageReader(socket);
    const writer = new (await import("vscode-ws-jsonrpc")).WebSocketMessageWriter(socket);
    const connection = createMessageConnection(reader, writer);

    const client = new AdilaLSPClient(lang, rootUri, connection, onError);

    connection.onClose(() => {
      client.dispose();
      clients.delete(`${lang}::${rootUri}`);
    });
    connection.onError(([err]) => onError(`Erro LSP (${lang})`, err));
    connection.onRequest("workspace/applyEdit", () => {
      // O AdilaEditor aplica edits localmente no accept de completion/code action.
      // Responde sucesso para servidores que enviam applyEdit por compatibilidade.
      return { applied: true };
    });

    connection.listen();

    try {
      const initResp = await connection.sendRequest<proto.InitializeResult>("initialize", {
        processId: null,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: "root" }],
        capabilities: {
          textDocument: {
            synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false },
            completion: {
              completionItem: {
                snippetSupport: true,
                documentationFormat: ["markdown", "plaintext"],
                insertReplaceSupport: true,
                resolveSupport: { properties: ["documentation", "detail"] },
              },
              contextSupport: true,
            },
            hover: { contentFormat: ["markdown", "plaintext"] },
            publishDiagnostics: { relatedInformation: true },
            definition: { linkSupport: true },
            documentFormatting: { dynamicRegistration: false },
            documentRangeFormatting: { dynamicRegistration: false },
            codeAction: {
              dynamicRegistration: false,
              codeActionLiteralSupport: {
                codeActionKind: {
                  valueSet: [
                    "",
                    "quickfix",
                    "refactor",
                    "refactor.extract",
                    "refactor.inline",
                    "refactor.rewrite",
                    "source",
                    "source.organizeImports",
                    "source.fixAll",
                  ],
                },
              },
              resolveSupport: { properties: ["edit", "command"] },
            },
          },
          workspace: {
            applyEdit: true,
            workspaceEdit: {
              documentChanges: true,
              resourceOperations: ["create", "rename", "delete"],
              failureHandling: "textOnlyTransactional",
            },
          },
        },
      } as proto.InitializeParams);

      client.serverCaps = initResp.capabilities ?? {};
      await connection.sendNotification("initialized", {});
    } catch (err) {
      onError(`Falha no initialize do LSP (${lang})`, err);
      ws.close();
      return null;
    }

    client.installDiagnosticsHandler();
    client.installWorkspaceEditHandler();
    return client;
  }

  setWorkspaceEditHandler(handler: WorkspaceEditHandler | null) {
    this.workspaceEditHandler = handler;
  }

  /**
   * Abre um documento. Retorna função de detach que envia didClose.
   * Chamar de novo com mesmo URI é no-op (mantém o estado).
   */
  openDocument(
    uri: string,
    text: string,
    languageId: string,
    onDiagnostics: DiagnosticsHandler,
  ): () => void {
    if (this.docs.has(uri)) {
      this.diagnosticsHandlers.set(uri, onDiagnostics);
      return () => this.closeDocument(uri);
    }

    this.docs.set(uri, { version: 1 });
    this.diagnosticsHandlers.set(uri, onDiagnostics);

    void this.connection.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text,
      },
    } satisfies proto.DidOpenTextDocumentParams);

    return () => this.closeDocument(uri);
  }

  /**
   * Notifica mudança no conteúdo. Usa "full text sync" por simplicidade.
   */
  changeDocument(uri: string, text: string) {
    const entry = this.docs.get(uri);
    if (!entry) return;
    entry.version += 1;
    void this.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: entry.version },
      contentChanges: [{ text }],
    } satisfies proto.DidChangeTextDocumentParams);
  }

  closeDocument(uri: string) {
    if (!this.docs.has(uri)) return;
    this.docs.delete(uri);
    this.diagnosticsHandlers.delete(uri);
    void this.connection.sendNotification("textDocument/didClose", {
      textDocument: { uri },
    } satisfies proto.DidCloseTextDocumentParams);
  }

  async requestHover(uri: string, line: number, character: number): Promise<proto.Hover | null> {
    if (!this.serverCaps.hoverProvider) return null;
    if (!this.docs.has(uri)) return null;
    try {
      return await this.connection.sendRequest<proto.Hover | null>("textDocument/hover", {
        textDocument: { uri },
        position: { line, character },
      } satisfies proto.HoverParams);
    } catch (err) {
      this.onError(`Erro em hover (${this.lang})`, err);
      return null;
    }
  }

  async requestCompletion(
    uri: string,
    line: number,
    character: number,
  ): Promise<proto.CompletionItem[]> {
    if (!this.serverCaps.completionProvider) return [];
    if (!this.docs.has(uri)) return [];
    try {
      const resp = await this.connection.sendRequest<
        proto.CompletionItem[] | proto.CompletionList | null
      >("textDocument/completion", {
        textDocument: { uri },
        position: { line, character },
        context: { triggerKind: 1 },
      } satisfies proto.CompletionParams);
      if (!resp) return [];
      return Array.isArray(resp) ? resp : resp.items;
    } catch (err) {
      this.onError(`Erro em completion (${this.lang})`, err);
      return [];
    }
  }

  async resolveCompletion(item: proto.CompletionItem): Promise<proto.CompletionItem> {
    const provider = this.serverCaps.completionProvider;
    const canResolve = typeof provider === "object" && !!provider.resolveProvider;
    if (!canResolve) return item;
    try {
      return await this.connection.sendRequest<proto.CompletionItem>(
        "completionItem/resolve",
        item,
      );
    } catch (err) {
      this.onError(`Erro ao resolver completion (${this.lang})`, err);
      return item;
    }
  }

  async requestDefinition(
    uri: string,
    line: number,
    character: number,
  ): Promise<proto.Location[] | proto.LocationLink[] | null> {
    if (!this.serverCaps.definitionProvider) return null;
    if (!this.docs.has(uri)) return null;
    try {
      const resp = await this.connection.sendRequest<
        proto.Location | proto.Location[] | proto.LocationLink[] | null
      >("textDocument/definition", {
        textDocument: { uri },
        position: { line, character },
      } satisfies proto.DefinitionParams);
      if (!resp) return null;
      return Array.isArray(resp) ? resp : [resp];
    } catch (err) {
      this.onError(`Erro em definition (${this.lang})`, err);
      return null;
    }
  }

  async requestCodeActions(
    uri: string,
    range: proto.Range,
    diagnostics: proto.Diagnostic[],
  ): Promise<proto.CodeAction[]> {
    if (!this.serverCaps.codeActionProvider) return [];
    if (!this.docs.has(uri)) return [];
    try {
      const resp = await this.connection.sendRequest<(proto.CodeAction | proto.Command)[] | null>(
        "textDocument/codeAction",
        {
          textDocument: { uri },
          range,
          context: { diagnostics },
        } satisfies proto.CodeActionParams,
      );
      return (resp ?? []).filter(
        (item): item is proto.CodeAction => "title" in item && ("edit" in item || "kind" in item),
      );
    } catch (err) {
      this.onError(`Erro em code actions (${this.lang})`, err);
      return [];
    }
  }

  async requestDocumentFormatting(
    uri: string,
    options: proto.FormattingOptions,
  ): Promise<proto.TextEdit[]> {
    if (!this.serverCaps.documentFormattingProvider) return [];
    if (!this.docs.has(uri)) return [];
    try {
      const resp = await this.connection.sendRequest<proto.TextEdit[] | null>(
        "textDocument/formatting",
        {
          textDocument: { uri },
          options,
        } satisfies proto.DocumentFormattingParams,
      );
      return resp ?? [];
    } catch (err) {
      this.onError(`Erro em format document (${this.lang})`, err);
      return [];
    }
  }

  async requestRangeFormatting(
    uri: string,
    range: proto.Range,
    options: proto.FormattingOptions,
  ): Promise<proto.TextEdit[]> {
    if (!this.serverCaps.documentRangeFormattingProvider) return [];
    if (!this.docs.has(uri)) return [];
    try {
      const resp = await this.connection.sendRequest<proto.TextEdit[] | null>(
        "textDocument/rangeFormatting",
        {
          textDocument: { uri },
          range,
          options,
        } satisfies proto.DocumentRangeFormattingParams,
      );
      return resp ?? [];
    } catch (err) {
      this.onError(`Erro em format selection (${this.lang})`, err);
      return [];
    }
  }

  async resolveCodeAction(action: proto.CodeAction): Promise<proto.CodeAction> {
    const provider = this.serverCaps.codeActionProvider;
    const canResolve = typeof provider === "object" && !!provider.resolveProvider;
    if (!canResolve) return action;
    try {
      return await this.connection.sendRequest<proto.CodeAction>("codeAction/resolve", action);
    } catch (err) {
      this.onError(`Erro ao resolver code action (${this.lang})`, err);
      return action;
    }
  }

  async executeCommand(command: proto.Command): Promise<void> {
    if (!command.command) return;
    try {
      await this.connection.sendRequest("workspace/executeCommand", command);
    } catch (err) {
      this.onError(`Erro ao executar comando LSP (${this.lang})`, err);
    }
  }

  private installDiagnosticsHandler() {
    this.connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: proto.PublishDiagnosticsParams) => {
        const handler = this.diagnosticsHandlers.get(params.uri);
        if (handler) handler(params.diagnostics);
      },
    );
  }

  private installWorkspaceEditHandler() {
    this.connection.onRequest(
      "workspace/applyEdit",
      (params: proto.ApplyWorkspaceEditParams): proto.ApplyWorkspaceEditResult => {
        const applied = this.workspaceEditHandler?.(params.edit) ?? false;
        return {
          applied,
          failureReason: applied ? undefined : "Nenhum documento aberto aceitou a edição.",
        };
      },
    );
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const uri of this.docs.keys()) {
      const handler = this.diagnosticsHandlers.get(uri);
      handler?.([]);
    }
    this.docs.clear();
    this.diagnosticsHandlers.clear();
    try {
      this.connection.dispose();
    } catch {
      /* ignore */
    }
  }
}
