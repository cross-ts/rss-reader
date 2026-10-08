import { useEffect, useRef, useState, type RefObject } from 'react';

export const PTR_MAX = 90;
export const PTR_READY = 60;
const PTR_LOADING = 56;

export const rubber = (d: number) => PTR_MAX * (1 - Math.exp(-d / 150));

export type PtrPhase = 'idle' | 'pull' | 'ready' | 'loading';

/**
 * touch / マウスドラッグ / wheel による pull-to-refresh。
 * リスナーは document に張り、呼び出したコンポーネントがマウントされている間だけ有効。
 * マウスドラッグは area 内で始まったものだけ対象にする。
 */
export function usePullToRefresh(onRefresh: () => Promise<void>, area: RefObject<HTMLElement | null>) {
  const [ui, setUi] = useState({ height: 0, phase: 'idle' as PtrPhase, animate: false });
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    const s = { d: 0, loading: false, tracking: false, startY: 0, moved: false, wheel: 0 };
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;

    const draw = (animate: boolean) => {
      const height = s.loading ? PTR_LOADING : rubber(s.d);
      const phase: PtrPhase = s.loading ? 'loading' : height >= PTR_READY ? 'ready' : height > 0 ? 'pull' : 'idle';
      setUi({ height, phase, animate });
    };

    const release = () => {
      s.tracking = false;
      s.wheel = 0;
      if (s.loading) return;
      if (rubber(s.d) >= PTR_READY) {
        s.loading = true;
        draw(true);
        refresh.current().finally(() => {
          s.loading = false;
          s.d = 0;
          draw(true);
        });
      } else {
        s.d = 0;
        draw(true);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (s.loading || scrollY > 0) return;
      s.tracking = true;
      s.startY = e.touches[0].clientY;
      s.d = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!s.tracking) return;
      const dy = e.touches[0].clientY - s.startY;
      if (dy > 0 && scrollY <= 0) {
        s.d = dy;
        draw(false);
        if (e.cancelable) e.preventDefault();
      } else if (s.d) {
        s.d = 0;
        draw(false);
      }
    };
    const onTouchEnd = () => {
      if (s.tracking) release();
    };

    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (e.button !== 0 || s.loading || scrollY > 0 || !area.current?.contains(t) || t.closest('button,input')) return;
      s.tracking = true;
      s.startY = e.clientY;
      s.d = 0;
      s.moved = false;
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!s.tracking || e.buttons !== 1) return;
      const dy = e.clientY - s.startY;
      if (dy > 5) s.moved = true;
      s.d = Math.max(0, dy);
      draw(false);
    };
    const onMouseUp = () => {
      if (!s.tracking) return;
      const moved = s.moved;
      release();
      if (moved) {
        // ドラッグ直後にリンクが開かないよう、次の click を捨てる
        const swallow = (ev: Event) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        document.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', swallow, true), 0);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (s.loading) return;
      if (e.deltaY < 0 && scrollY <= 0) {
        e.preventDefault();
        s.wheel += -e.deltaY;
        s.d = s.wheel;
        draw(false);
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(release, 160);
      } else if (s.wheel) {
        s.wheel = 0;
        s.d = 0;
        draw(true);
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      clearTimeout(wheelTimer);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('wheel', onWheel);
    };
  }, [area]);

  return ui;
}
