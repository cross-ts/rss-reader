import { useRef, useState, type ReactNode } from 'react';
import { ArticleCard } from '../components/ArticleCard';
import { TimelineList } from '../components/ArticleTimeline';
import { Icon } from '../components/Icon';
import { useArticles } from '../hooks/useArticles';
import { useMarkRead, useRefresh, useSetRead } from '../hooks/useArticleMutations';
import { HomeHeader, RefreshButton, useUnreadTotal } from './HomeHeader';

const THRESHOLD = 80;

/**
 * 案E（Reeder / Gmail モバイル型）
 * - 縦はスクロール専用。既読操作は横方向に分離する。
 *   右スワイプ: 既読 ⇄ 未読 / 左スワイプ: ここまで既読
 * - 既読は1行に圧縮、未読は左帯＋本文表示で一目で区別。
 */
export function SwipeMock() {
  const query = useArticles('');
  const setRead = useSetRead();
  const markRead = useMarkRead();
  const refresh = useRefresh();
  const unread = useUnreadTotal();

  return (
    <>
      <HomeHeader
        sub={
          <>
            {unread != null && <span className="font-semibold text-accent">未読 {unread} 件</span>} · 右スワイプで既読 /
            左でここまで既読
          </>
        }
        actions={<RefreshButton onRefresh={refresh} />}
      />
      <TimelineList
        query={query}
        emptyText="記事がありません。"
        renderItem={(a, i, all) => (
          <SwipeRow
            key={a.id}
            right={a.isRead ? '未読に戻す' : '既読'}
            left="ここまで既読"
            onRight={() => setRead(a.id, !a.isRead)}
            onLeft={() => markRead(all.slice(0, i + 1).filter((x) => !x.isRead).map((x) => x.id))}
          >
            <ArticleCard article={a} onSetRead={setRead} unreadBar compact={a.isRead} />
          </SwipeRow>
        )}
        end={<div className="px-5 py-12 text-center text-sm text-muted">これより古い記事はありません</div>}
      />
    </>
  );
}

/** 横ドラッグ（タッチ・マウス）で onRight / onLeft を呼ぶ行。縦の動きはブラウザのスクロールに任せる。 */
export function SwipeRow({
  children,
  right,
  left,
  onRight,
  onLeft,
}: {
  children: ReactNode;
  right: string;
  left: string;
  onRight: () => void;
  onLeft: () => void;
}) {
  const [dx, setDx] = useState(0);
  const s = useRef({ x: 0, y: 0, id: -1, axis: null as 'h' | 'v' | null, dx: 0, swallow: false });

  const end = () => {
    if (s.current.axis === 'h') {
      if (s.current.dx > THRESHOLD) onRight();
      else if (s.current.dx < -THRESHOLD) onLeft();
      s.current.swallow = true;
    }
    s.current = { ...s.current, id: -1, axis: null, dx: 0 };
    setDx(0);
  };

  return (
    <div
      className="relative overflow-hidden"
      style={{ touchAction: 'pan-y' }}
      onDragStart={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if ((e.target as Element).closest('button')) return;
        s.current = { x: e.clientX, y: e.clientY, id: e.pointerId, axis: null, dx: 0, swallow: false };
      }}
      onPointerMove={(e) => {
        const c = s.current;
        if (c.id !== e.pointerId) return;
        const mx = e.clientX - c.x;
        const my = e.clientY - c.y;
        if (!c.axis && Math.hypot(mx, my) > 8) {
          c.axis = Math.abs(mx) > Math.abs(my) ? 'h' : 'v';
          if (c.axis === 'h') e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (c.axis === 'h') {
          c.dx = mx;
          setDx(Math.max(-160, Math.min(160, mx)));
        }
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onClickCapture={(e) => {
        if (s.current.swallow) {
          e.preventDefault();
          e.stopPropagation();
          s.current.swallow = false;
        }
      }}
    >
      <div
        className={`absolute inset-0 flex items-center px-6 text-sm font-semibold text-white ${dx >= 0 ? 'justify-start bg-accent' : 'justify-end bg-sky-600'}`}
        style={{ opacity: Math.min(1, Math.abs(dx) / THRESHOLD) }}
      >
        <span className="inline-flex items-center gap-1.5">
          <Icon name={dx >= 0 ? 'check' : 'up'} small />
          {dx >= 0 ? right : left}
        </span>
      </div>
      <div
        className={`relative bg-bg ${dx === 0 ? 'transition-transform duration-200' : ''}`}
        style={{ transform: `translateX(${dx}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
