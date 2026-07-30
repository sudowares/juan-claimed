import * as React from "react";
import { ApiError } from "@/lib/api";
import { AlertModal, type AlertVariant } from "@/components/ui/alert-modal";
import type { ModalSize } from "@/components/ui/modal";

interface ShowAlertInput {
  variant: AlertVariant;
  message: string;
  title?: string;
  /** Defaults to the modal's own "xs" — widen for a longer message (e.g. a multi-line
   * bulleted validation list), which reads cramped at the default width. */
  size?: ModalSize;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
}

interface ShowConfirmInput {
  message: string;
  title?: string;
  size?: ModalSize;
  /** Defaults to "Delete". */
  confirmLabel?: string;
  onConfirm: () => void;
}

interface AlertContextValue {
  showAlert: (input: ShowAlertInput) => void;
  /** Convenience for a catch block: shows `err.message` (backend's own `error` string) as
   * an error alert if `err` is an ApiError, otherwise a generic fallback. */
  showApiError: (err: unknown, fallback?: string) => void;
  /** A destructive confirm dialog (Cancel + a destructive confirm button). Runs onConfirm
   * only if the user confirms. */
  showConfirm: (input: ShowConfirmInput) => void;
}

const AlertContext = React.createContext<AlertContextValue | null>(null);

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ShowAlertInput | null>(null);

  const showAlert = React.useCallback((input: ShowAlertInput) => setState(input), []);

  const showApiError = React.useCallback(
    (err: unknown, fallback = "Something went wrong. Please try again.") => {
      setState({ variant: "error", message: err instanceof ApiError ? err.message : fallback });
    },
    [],
  );

  const showConfirm = React.useCallback((input: ShowConfirmInput) => {
    setState({
      variant: "warning",
      message: input.message,
      title: input.title ?? "Are you sure?",
      size: input.size,
      confirmLabel: input.confirmLabel ?? "Delete",
      cancelLabel: "Cancel",
      onConfirm: input.onConfirm,
    });
  }, []);

  const value = React.useMemo(() => ({ showAlert, showApiError, showConfirm }), [showAlert, showApiError, showConfirm]);

  return (
    <AlertContext.Provider value={value}>
      {children}
      {state && (
        <AlertModal
          open={!!state}
          onOpenChange={(open) => !open && setState(null)}
          variant={state.variant}
          title={state.title}
          message={state.message}
          size={state.size}
          confirmLabel={state.confirmLabel}
          cancelLabel={state.cancelLabel}
          onConfirm={state.onConfirm}
        />
      )}
    </AlertContext.Provider>
  );
}

// Surfaces the backend's own message/error string directly — every ApiEnvelope response
// (success or failure) already carries one meant to be shown to the user as-is.
export function useAlert() {
  const ctx = React.useContext(AlertContext);
  if (!ctx) throw new Error("useAlert must be used within an AlertProvider");
  return ctx;
}
