import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

// ---- Types ----

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
  action?: ToastAction;
}

interface ToastContextValue {
  addToast: (message: string, type?: Toast['type'], action?: ToastAction, duration?: number) => void;
}

// ---- Context ----

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ---- Provider ----

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (message: string, type: Toast['type'] = 'info', action?: ToastAction, duration = 5000) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, type, action }]);
      const timer = setTimeout(() => {
        removeToast(id);
      }, duration);
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

// ---- Toast container (bottom-right stack) ----

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

// ---- Individual toast ----

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const bgClass =
    toast.type === 'success'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : toast.type === 'error'
        ? 'bg-red-50 border-red-200 text-red-800'
        : 'bg-white border-border text-text-primary';

  const iconColor =
    toast.type === 'success'
      ? 'text-emerald-500'
      : toast.type === 'error'
        ? 'text-red-500'
        : 'text-accent';

  return (
    <div
      className={[
        'flex items-start gap-2.5 px-4 py-3 rounded-lg border shadow-card-hover text-sm animate-slide-in',
        bgClass,
      ].join(' ')}
    >
      {/* Icon */}
      <span className={['flex-shrink-0 mt-0.5', iconColor].join(' ')}>
        {toast.type === 'success' && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
        {toast.type === 'error' && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        )}
        {toast.type === 'info' && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
        )}
      </span>

      {/* Message */}
      <span className="flex-1 text-[13px] leading-snug">{toast.message}</span>

      {/* Action button */}
      {toast.action && (
        <button
          onClick={toast.action.onClick}
          className="flex-shrink-0 text-[13px] font-semibold text-accent hover:text-accent-hover transition-colors underline underline-offset-2"
        >
          {toast.action.label}
        </button>
      )}

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary rounded transition-colors"
        aria-label="Dismiss notification"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
