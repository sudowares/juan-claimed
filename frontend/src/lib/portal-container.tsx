import * as React from "react";

// Lets a Popover portal into a specific ancestor's own DOM subtree instead of straight to
// document.body — needed so CSS scoped to that ancestor (e.g. Modal's .admin-modal-text,
// see index.css) still reaches dropdown content. A body-level portal escapes normal
// DOM-descendant CSS scoping entirely, but a React context provider still reaches into
// portaled content fine (context follows the React tree, not the DOM tree) — read from
// inside ui/popover.tsx's PopoverContent itself.
export const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext);
}
