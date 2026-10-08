import { useEffect, useRef, useState, type ReactNode } from 'react';

export const btnCls = 'rounded-full border border-line px-[18px] py-[9px] text-sm font-semibold hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent';
export const btnPri = `${btnCls} !border-accent bg-accent text-white hover:!bg-accent hover:brightness-110`;
export const btnDanger = `${btnCls} !border-[#d93636] !bg-[#d93636] text-white hover:brightness-110`;

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    box.current?.querySelector('input')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-2xl border border-line bg-bg p-6"
      >
        <h3 className="mb-4 text-xl font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export const inputCls =
  'w-full rounded-[10px] border border-line bg-panel px-3.5 py-[11px] text-fg outline-0 focus:border-accent';

export function Footer({ children }: { children: ReactNode }) {
  return <div className="mt-[22px] flex justify-end gap-2">{children}</div>;
}

export function ConfirmDialog(props: {
  title: string;
  message: string;
  label: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <div className="leading-relaxed text-muted">{props.message}</div>
      <Footer>
        <button type="button" className={btnCls} onClick={props.onClose}>
          キャンセル
        </button>
        <button
          type="button"
          className={btnDanger}
          onClick={() => {
            props.onClose();
            props.onConfirm();
          }}
        >
          {props.label}
        </button>
      </Footer>
    </Modal>
  );
}

export function PromptDialog(props: {
  title: string;
  label: string;
  value?: string;
  okLabel: string;
  onSubmit: (v: string) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState(props.value ?? '');
  const go = () => {
    const t = v.trim();
    if (!t) return;
    props.onClose();
    props.onSubmit(t);
  };
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <label className="mb-1.5 block text-[13px] text-muted">
        {props.label}
        <input
          type="text"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && go()}
          className={`${inputCls} mt-1.5`}
        />
      </label>
      <Footer>
        <button type="button" className={btnCls} onClick={props.onClose}>
          キャンセル
        </button>
        <button type="button" className={btnPri} onClick={go}>
          {props.okLabel}
        </button>
      </Footer>
    </Modal>
  );
}
