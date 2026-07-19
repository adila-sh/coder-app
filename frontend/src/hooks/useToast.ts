import { useEffect, useState } from "react";

export type ToastVariant = "default" | "success" | "error" | "clipboard";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

type Listener = (toasts: Toast[]) => void;

const listeners = new Set<Listener>();
let state: Toast[] = [];
const AUTO_DISMISS_MS = 4000;
const CLIPBOARD_DISMISS_MS = 1000;

function notify() {
  for (const l of listeners) {
    l(state);
  }
}

function emit(
  title: string,
  description: string | undefined,
  variant: ToastVariant,
  durationMs: number = AUTO_DISMISS_MS,
): string {
  const id = Math.random().toString(36).slice(2, 10);
  state = [...state, { id, title, description, variant }];
  notify();
  setTimeout(() => {
    dismiss(id);
  }, durationMs);
  return id;
}

function dismiss(id: string): void {
  state = state.filter((t) => t.id !== id);
  notify();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "erro desconhecido";
}

export const toast = {
  show: (title: string, description?: string) => emit(title, description, "default"),
  success: (title: string, description?: string) => emit(title, description, "success"),
  error: (title: string, err?: unknown) =>
    emit(title, err === undefined ? undefined : errorMessage(err), "error"),
  clipboard: (description?: string) =>
    emit("Copiado para clipboard", description, "clipboard", CLIPBOARD_DISMISS_MS),
  dismiss,
};

/**
 * Copia texto para o clipboard e exibe um toast bottom-center curto (1s).
 * Devolve `true` se conseguiu copiar.
 */
export async function copyToClipboard(text: string, description?: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.clipboard(description ?? text);
    return true;
  } catch (err) {
    toast.error("Não foi possível copiar", err);
    return false;
  }
}

export function useToasts(): Toast[] {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return current;
}
