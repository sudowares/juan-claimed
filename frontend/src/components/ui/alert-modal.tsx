import { CheckCircle2, TriangleAlert, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal, type ModalSize } from "@/components/ui/modal";

export type AlertVariant = "success" | "warning" | "error" | "info";

const VARIANT_CONFIG: Record<AlertVariant, { icon: typeof CheckCircle2; iconClassName: string; badgeClassName: string }> = {
  success: { icon: CheckCircle2, iconClassName: "text-emerald-600", badgeClassName: "bg-emerald-500/10" },
  warning: { icon: TriangleAlert, iconClassName: "text-amber-600", badgeClassName: "bg-amber-500/10" },
  error: { icon: XCircle, iconClassName: "text-destructive", badgeClassName: "bg-destructive/10" },
  info: { icon: Info, iconClassName: "text-primary", badgeClassName: "bg-primary/10" },
};

export interface AlertModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: AlertVariant;
  /** Defaults to a variant-appropriate title (Success / Warning / Error / Notice) if omitted. */
  title?: string;
  /** The backend's own `message`/`error` string — shown as-is, no rewording. */
  message: string;
  size?: ModalSize;
  confirmLabel?: string;
  onConfirm?: () => void;
  /** When set, renders a secondary Cancel button that just closes (no onConfirm) — turns this
   * info dialog into a confirm dialog (see useAlert's showConfirm). */
  cancelLabel?: string;
}

const DEFAULT_TITLES: Record<AlertVariant, string> = {
  success: "Success",
  warning: "Warning",
  error: "Something went wrong",
  info: "Notice",
};

// A small, centered message dialog — distinct from SidePanel (which is for forms/editing).
// Backend responses (ApiEnvelope) always carry a human-readable `message` (success) or
// `error` (failure) string meant to be shown directly, so this is a thin variant-styled
// shell around that text rather than another place to author copy.
export function AlertModal({ open, onOpenChange, variant, title, message, size = "xs", confirmLabel = "Close", onConfirm, cancelLabel }: AlertModalProps) {
  const { icon: Icon, iconClassName, badgeClassName } = VARIANT_CONFIG[variant];
  // A short single-sentence message reads fine centered; a multi-line list (e.g. several
  // validation issues, one per line) reads as a ragged, hard-to-scan center-aligned block —
  // left-align just the message in that case, title/icon stay centered either way.
  const isMultiline = message.includes("\n");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size={size}
      showCloseButton={false}
      footer={
        <div className={cn("flex w-full flex-col gap-2 sm:flex-row sm:justify-center", cancelLabel && "sm:justify-end")}>
          {cancelLabel && (
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
          )}
          <Button
            type="button"
            className="w-full sm:w-auto"
            variant={variant === "error" || variant === "warning" ? "destructive" : "default"}
            onClick={() => {
              onConfirm?.();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <div className={cn("flex size-12 items-center justify-center rounded-full", badgeClassName)}>
          <Icon className={cn("size-6", iconClassName)} />
        </div>
        <div className={cn("space-y-1", isMultiline && "w-full")}>
          <p className="text-base font-semibold text-foreground">{title ?? DEFAULT_TITLES[variant]}</p>
          {/* whitespace-pre-line: a plain <p> collapses newlines by default — callers that
              join multiple issues into one message (e.g. form validation) use "\n" to
              separate them into a readable list instead of one run-on sentence. */}
          <p className={cn("text-sm whitespace-pre-line text-muted-foreground", isMultiline && "text-left")}>{message}</p>
        </div>
      </div>
    </Modal>
  );
}
