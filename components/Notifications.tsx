"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface Toast {
  id: number;
  type: "error" | "notice" | "draw";
  message: string;
}

interface ConfirmState {
  message: string;
  resolve: (value: boolean) => void;
}

const NotificationsContext = createContext<{
  notify: (type: "error" | "notice" | "draw", message: string) => void;
  confirm: (message: string) => Promise<boolean>;
} | null>(null);

export function Notifications({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const notify = (type: "error" | "notice" | "draw", message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const confirm = (message: string) =>
    new Promise<boolean>((resolve) => {
      setConfirmState({ message, resolve });
    });

  return (
    <NotificationsContext.Provider value={{ notify, confirm }}>
      {children}
      <div className="fixed top-4 right-4 space-y-2 z-50">
        {toasts.filter(t => t.type !== "draw").map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded shadow text-white $
              {t.type === "error" ? "bg-red-600" : "bg-blue-600"}
            `}
          >
            {t.message}
          </div>
        ))}
      </div>
      <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
        {toasts.filter(t => t.type === "draw").map((t) => (
          <div
            key={t.id}
            className="fade-then-out px-6 py-3 rounded-full bg-black/80 text-white"
          >
            {t.message}
          </div>
        ))}
      </div>
      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-white dark:bg-zinc-900 p-4 rounded shadow max-w-sm w-full">
            <div className="mb-4">{confirmState.message}</div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 rounded bg-gray-300 dark:bg-gray-700"
                onClick={() => {
                  confirmState.resolve(false);
                  setConfirmState(null);
                }}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 rounded bg-blue-600 text-white"
                onClick={() => {
                  confirmState.resolve(true);
                  setConfirmState(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within <Notifications>");
  return ctx;
}

