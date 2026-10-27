import { useRef } from 'react';
import { ArticleTimeline } from '../components/ArticleTimeline';
import { useRefresh } from '../hooks/useArticleMutations';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

const LABEL = { idle: '引っ張って更新', pull: '引っ張って更新', ready: '離して更新', loading: '更新中…' };

/** 現行 UI（比較用にそのまま残す） */
export function CurrentMock() {
  const area = useRef<HTMLDivElement>(null);
  const { height, phase, animate } = usePullToRefresh(useRefresh(), area);
  return (
    <div ref={area}>
      <div
        style={{ height }}
        className={`flex items-center justify-center gap-2.5 overflow-hidden text-sm text-muted ${animate ? 'transition-[height] duration-250' : ''}`}
      >
        <span
          style={phase === 'loading' ? undefined : { transform: `rotate(${Math.round(height * 4)}deg)` }}
          className={`inline-block size-3.5 rounded-full border-2 border-line border-t-accent ${phase === 'loading' ? 'animate-spin' : ''}`}
        />
        {LABEL[phase]}
      </div>
      <ArticleTimeline q="" emptyText="記事がありません。" />
    </div>
  );
}
