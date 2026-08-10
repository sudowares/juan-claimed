import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogClose, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PortalContainerContext } from "@/lib/portal-container";

// Same percent-of-viewport scale as SidePanel (components/ui/side-panel.tsx), so xs/sm/md/
// lg/xl mean the same width share regardless of which shell a form uses.
const MODAL_SIZES = {
  xs: "sm:max-w-[30dvw]",
  sm: "sm:max-w-[40dvw]",
  md: "sm:max-w-[50dvw]",
  lg: "sm:max-w-[60dvw]",
  xl: "sm:max-w-[70dvw]",
  "2xl": "sm:max-w-6xl",
  full: "sm:max-w-[95vw]",
} as const;

export type ModalSize = keyof typeof MODAL_SIZES;

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Width tier. Defaults to "xl" — this component exists for the wide/multi-field cases. */
  size?: ModalSize;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned action row (reverses to full-width stack on mobile). Omit for no footer. */
  footer?: React.ReactNode;
  showCloseButton?: boolean;
  children: React.ReactNode;
  contentClassName?: string;
  bodyClassName?: string;
}

// Generic wide modal shell. Header/footer are spacing-only, not bordered strips — the
// title row and action row breathe with the same gap as everything else instead of being
// boxed off. Content that needs visual grouping should use ModalSection below rather than
// the modal chrome itself carrying borders.
export function Modal({
  open,
  onOpenChange,
  size = "xl",
  title,
  description,
  footer,
  showCloseButton = true,
  children,
  contentClassName,
  bodyClassName,
}: ModalProps) {
  // Doubles as the portal target for every Popover opened from inside this modal (see
  // PortalContainerContext) — display:contents keeps it out of the flex layout below, it
  // exists purely as a DOM anchor so .admin-modal-text (index.css) reaches dropdown content
  // that would otherwise portal straight to document.body, outside this subtree entirely.
  const [portalContainer, setPortalContainer] = React.useState<HTMLDivElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn("admin-modal-text flex max-h-[85vh] w-full flex-col gap-5 p-6", MODAL_SIZES[size], contentClassName)}
      >
        <div ref={setPortalContainer} className="contents">
          <PortalContainerContext.Provider value={portalContainer}>
            {(title || description) && (
              <div className="flex shrink-0 items-start justify-between gap-4">
                <div className="space-y-1">
                  {title && <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>}
                  {description && <DialogDescription>{description}</DialogDescription>}
                </div>
                {showCloseButton && (
                  <DialogClose asChild>
                    <Button type="button" size="icon" variant="ghost" className="-mt-1 -mr-1 size-8 shrink-0">
                      <X className="size-4" />
                    </Button>
                  </DialogClose>
                )}
              </div>
            )}

            <div className={cn("min-h-0 flex-1 space-y-7 overflow-y-auto thin-scrollbar", bodyClassName)}>{children}</div>

            {footer && <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
          </PortalContainerContext.Provider>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface ModalSectionProps {
  /** Omit for a single-section modal — one bordered group is still kept for consistent chrome, it just doesn't need a label. */
  title?: React.ReactNode;
  /** e.g. a "New Truck" / "Cancel" toggle button, right-aligned next to the title. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

// A bordered content group inside a Modal's body — for forms with more than one logical
// section (identity vs. role assignment vs. password, etc.). Skip this entirely for a
// truly single-block modal; use it title-less when there's exactly one section but the
// content still benefits from being visually set apart.
export function ModalSection({ title, action, children, className }: ModalSectionProps) {
  return (
    <div className={cn("space-y-6 rounded-xl border border-border p-4", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h4 className="text-sm font-semibold text-foreground">{title}</h4>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
