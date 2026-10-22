import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

const TOAST_MS = 6000;

interface ToastApi {
  /** Shows a short confirmation in the polite live region ("Pořadí uloženo"). */
  show(message: string): void;
}

interface Item {
  id: number;
  message: string;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Toasts: one persistent polite live region (so every message is announced) with self-removing lines. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const active = timers.current;
    return () => {
      active.forEach((t) => clearTimeout(t));
      active.clear();
    };
  }, []);

  const show = useCallback((message: string) => {
    const id = (counter.current += 1);
    setItems((current) => [...current, { id, message }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setItems((current) => current.filter((item) => item.id !== id));
    }, TOAST_MS);
    timers.current.add(timer);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <p key={item.id} className="toast">
            {item.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast outside ToastProvider');
  return api;
}
