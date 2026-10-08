import { useLayoutEffect, useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
}

/** アンカー要素の rect を基準に position:fixed で出すポップオーバー。 */
export function Menu({ anchor, items, onClose }: { anchor: HTMLElement; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
    let top = r.bottom + 4;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 4);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={pos}
      className="fixed z-[90] max-h-[60vh] min-w-[190px] overflow-y-auto rounded-xl border border-line bg-panel p-1.5 shadow-[0_10px_40px_rgba(0,0,0,.4)]"
    >
      {items.map((i) => (
        <button
          key={i.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            i.onSelect();
          }}
          className="block w-full rounded-lg px-3 py-2.5 text-left text-sm whitespace-pre hover:bg-hover"
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
