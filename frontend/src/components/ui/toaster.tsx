import { AlertCircle, CheckCircle2, ClipboardCheck, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { toast, useToasts, type Toast, type ToastVariant } from "@/hooks/useToast";

const iconByVariant: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  error: AlertCircle,
  clipboard: ClipboardCheck,
};

const toneByVariant: Record<ToastVariant, string> = {
  default: "border-border text-foreground",
  success: "border-primary/40 text-foreground",
  error: "border-destructive/60 text-foreground",
  clipboard: "",
};

const iconToneByVariant: Record<ToastVariant, string> = {
  default: "text-muted-foreground",
  success: "text-primary",
  error: "text-destructive",
  clipboard: "text-emerald-400",
};

export function Toaster() {
  const toasts = useToasts();
  const sideToasts = toasts.filter((t) => t.variant !== "clipboard");
  const clipboardToasts = toasts.filter((t) => t.variant === "clipboard");
  return (
    <>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2">
        <AnimatePresence initial={false}>
          {sideToasts.map((t) => {
            const Icon = iconByVariant[t.variant];
            return (
              <motion.div
                key={t.id}
                role="status"
                layout
                initial={{ opacity: 0, x: 32, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 32, scale: 0.95, transition: { duration: 0.18 } }}
                transition={{ type: "spring", stiffness: 420, damping: 30 }}
                className={cn(
                  "pointer-events-auto flex w-80 items-start gap-3 rounded-md border bg-popover px-4 py-3 shadow-lg",
                  toneByVariant[t.variant],
                )}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", iconToneByVariant[t.variant])} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t.title}</div>
                  {t.description && (
                    <div className="mt-0.5 text-xs text-muted-foreground break-words">
                      {t.description}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toast.dismiss(t.id)}
                  aria-label="Fechar"
                  className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Clipboard toasts: bottom-center, blur + transparente, sumiço rápido */}
      <div className="pointer-events-none fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2">
        <AnimatePresence initial={false}>
          {clipboardToasts.map((t) => (
            <ClipboardToast key={t.id} t={t} />
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}

function ClipboardToast({ t }: { t: Toast }) {
  const Icon = iconByVariant[t.variant];
  return (
    <motion.div
      role="status"
      layout
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 480, damping: 32 }}
      className="flex items-center gap-2 rounded-full border border-white/10 bg-background/40 px-4 py-2 shadow-lg backdrop-blur-md backdrop-saturate-150"
    >
      <Icon className={cn("size-4 shrink-0", iconToneByVariant[t.variant])} />
      <span className="text-xs font-medium text-foreground">{t.title}</span>
      {t.description && t.description !== t.title && (
        <span className="max-w-[280px] truncate font-mono text-[11px] text-muted-foreground">
          {t.description}
        </span>
      )}
    </motion.div>
  );
}
