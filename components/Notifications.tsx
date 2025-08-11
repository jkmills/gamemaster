"use client";

import { createContext, useContext, useState, ReactNode, useRef, useEffect } from "react";

interface Toast {
  id: number;
  type: "error" | "notice" | "draw";
  message: string;
}

interface AggregatableToast {
  id: number;
  baseMessage: string;
  count: number;
}

interface ConfirmState {
  message:string;
  resolve: (value: boolean) => void;
}

const NotificationsContext = createContext<{
  notify: (type: "error" | "notice" | "draw", message: string) => void;
  confirm: (message: string) => Promise<boolean>;
} | null>(null);

export function Notifications({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeAggregate, setActiveAggregate] = useState<AggregatableToast | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const timeoutsRef = useRef(new Map<number, NodeJS.Timeout>());

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach(timeoutId => clearTimeout(timeoutId));
    };
  }, []);

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    if (activeAggregate?.id === id) {
      setActiveAggregate(null);
    }
    const timeoutId = timeoutsRef.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutsRef.current.delete(id);
    }
  };

  const addToast = (toast: Toast, duration: number) => {
    setToasts(prev => [toast, ...prev]);
    const timeoutId = setTimeout(() => removeToast(toast.id), duration);
    timeoutsRef.current.set(toast.id, timeoutId);
  };

  const resetToastTimer = (id: number, duration: number) => {
    const oldTimeoutId = timeoutsRef.current.get(id);
    if (oldTimeoutId) clearTimeout(oldTimeoutId);
    const newTimeoutId = setTimeout(() => removeToast(id), duration);
    timeoutsRef.current.set(id, newTimeoutId);
  };

  const notify = (type: "error" | "notice" | "draw", message: string) => {
    const DURATION = 5000;
    const normalized = message.trim();
    const base = normalized.replace(/[.!]$/, "");
    const canAggregate = type === 'draw' && /drew a card$/i.test(base);

    if (activeAggregate && (!canAggregate || activeAggregate.baseMessage !== base)) {
      setActiveAggregate(null);
    }

    if (canAggregate && activeAggregate?.baseMessage === base) {
      const newCount = activeAggregate.count + 1;
      const newToastMessage = `${base} (x${newCount})`;
      setToasts(prev =>
        prev.map(t => (t.id === activeAggregate.id ? { ...t, message: newToastMessage } : t))
      );
      setActiveAggregate(prev => ({ ...prev!, count: newCount }));
      resetToastTimer(activeAggregate.id, DURATION);
    } else {
      const id = Date.now();
      addToast({ id, type, message: canAggregate ? base : normalized }, DURATION);
      if (canAggregate) {
        setActiveAggregate({ id, baseMessage: base, count: 1 });
      }
    }
  };

  const confirm = (message: string) =>
    new Promise<boolean>((resolve) => {
      setConfirmState({ message, resolve });
    });

  return (
    <NotificationsContext.Provider value={{ notify, confirm }}>
      {children}
      <div className="fixed top-4 right-4 space-y-2 z-50 w-72">
        {toasts.slice(0, 5).map((t, i) => {
          let fromColor = "rgba(37, 99, 235, 0.9)";
          let toColor = "rgba(23, 59, 145, 0.9)";
          if (t.type === 'error') {
            fromColor = "rgba(220, 38, 38, 0.9)";
            toColor = "rgba(150, 28, 28, 0.9)";
          } else if (t.type === 'draw') {
            fromColor = "rgba(30, 30, 30, 0.9)";
            toColor = "rgba(0, 0, 0, 0.9)";
          }

          return (
            <div
              key={t.id}
              className="toast-animated px-4 py-3 rounded-md text-white font-semibold border border-white/20 shadow-2xl backdrop-blur-sm"
              style={{ background: `radial-gradient(circle at top left, ${fromColor} 0%, ${toColor} 100%)` }}
            >
              {t.message}
            </div>
          );
        })}
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

