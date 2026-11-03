"use client";
import { useEffect } from "react";

/** Warn before leaving with unsaved edits: tab close/reload and in-app link clicks. */
export function useUnsavedGuard(dirty: boolean, message = "You have unsaved changes. Leave without saving?") {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.defaultPrevented) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.hash) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, message]);
}
