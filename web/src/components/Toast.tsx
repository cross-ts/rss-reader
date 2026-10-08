import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ShowToast = (message: string) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback<ShowToast>((m) => {
    setMessage(m);
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 1600);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        className={`pointer-events-none fixed bottom-[84px] left-1/2 z-[100] -translate-x-1/2 whitespace-nowrap rounded-full bg-fg px-[18px] py-2.5 text-sm text-bg transition-opacity duration-200 sm:bottom-6 ${on ? 'opacity-100' : 'opacity-0'}`}
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}
