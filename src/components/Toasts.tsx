"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";

type Toast = { id: number; kind: "ok" | "error" | "info"; text: string };
const Ctx = createContext<{ push: (kind: Toast["kind"], text: string) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++n.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    // Errors stay until dismissed so they can't be missed.
    if (kind !== "error") setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : undefined}>
            <span>{t.text}</span>
            <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
