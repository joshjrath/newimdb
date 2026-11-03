"use client";
import { useCallback, useState } from "react";
import { useToast } from "./Toasts";

/**
 * Busy state plus toasts around an async call. Resolves to the call's result,
 * or undefined after showing the error (the caller's state is left untouched).
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { ok?: string | ((r: T) => string); errorPrefix?: string } = {}): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (opts.ok) toast.push("ok", typeof opts.ok === "function" ? opts.ok(r) : opts.ok);
        return r;
      } catch (e) {
        toast.push("error", `${opts.errorPrefix ?? ""}${(e as Error).message}`);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}
