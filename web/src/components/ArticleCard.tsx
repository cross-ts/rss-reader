import { memo, useMemo, type ReactNode } from 'react';
import type { Article } from '../api/client';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { decodeEntities } from '../utils/decodeEntities';
import { extractTextExcerpt, extractThumbnail } from '../utils/thumbnail';
import { formatDate } from '../utils/time';
import { safeHttpUrl } from '../utils/url';

interface Props {
  article: Article;
  onSetRead: (id: number, isRead: boolean) => void;
  /** 本文・画像を省いた1行表示（既読記事の圧縮表示用） */
  compact?: boolean;
  /** 未読記事の左端にアクセント色の帯を出す */
  unreadBar?: boolean;
  /** 既読記事を薄く表示する */
  dimRead?: boolean;
  /** アクション行の末尾に足すボタン */
  actions?: ReactNode;
}

export const ArticleCard = memo(function ArticleCard({ article: a, onSetRead, compact, unreadBar, dimRead, actions }: Props) {
  const toast = useToast();
  const thumb = useMemo(() => safeHttpUrl(extractThumbnail(a.content)), [a.content]);
  const excerpt = useMemo(() => extractTextExcerpt(a.content), [a.content]);
  const href = safeHttpUrl(a.url);
  const feedTitle = decodeEntities(a.feedTitle);

  const open = () => {
    if (!a.isRead) onSetRead(a.id, true);
  };
  const copy = async () => {
    try {
      if (!href || !navigator.clipboard) throw new Error('unavailable');
      await navigator.clipboard.writeText(href);
      toast('リンクをコピーしました');
    } catch {
      toast('コピーに失敗しました');
    }
  };

  const bar = unreadBar && !a.isRead ? "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-accent before:content-['']" : '';
  const link = (
    <a
      href={href ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={open}
      onAuxClick={(e) => e.button === 1 && open()}
      className="after:absolute after:inset-0 after:z-[1] after:content-[''] focus-visible:outline-2 focus-visible:outline-accent"
    >
      {decodeEntities(a.title)}
    </a>
  );

  if (compact) {
    return (
      <article
        data-article-id={a.id}
        className={`relative flex items-center gap-3 border-b border-line px-3.5 py-2.5 text-muted sm:px-5 ${bar}`}
      >
        <Avatar title={feedTitle} size={22} />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[15px] ${a.isRead ? '' : 'font-bold text-fg'}`}>{link}</div>
          <div className="truncate text-xs">
            {feedTitle} · {formatDate(a.publishedAt)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onSetRead(a.id, !a.isRead)}
          title={a.isRead ? '未読にする' : '既読にする'}
          aria-label={a.isRead ? '未読にする' : '既読にする'}
          className="relative z-[2] rounded-full p-2 hover:bg-hover hover:text-fg"
        >
          <Icon name={a.isRead ? 'undo' : 'check'} small />
        </button>
      </article>
    );
  }

  return (
    <article
      data-article-id={a.id}
      className={`relative flex gap-2.5 ${bar} ${dimRead && a.isRead ? 'opacity-50' : ''} border-b border-line px-3.5 pt-4 pb-1.5 sm:gap-3.5 sm:px-5 sm:pt-5 sm:pb-2`}
    >
      <div className="flex-none">
        <Avatar title={feedTitle} size={40} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-10 flex-wrap items-center gap-1.5 text-[15px] text-muted">
          {!a.isRead && <span title="未読" className="size-2 flex-none rounded-full bg-accent" />}
          <b className="font-bold text-fg">{feedTitle}</b>
          <span>{formatDate(a.publishedAt)}</span>
          {a.author && <span>· {decodeEntities(a.author)}</span>}
        </div>
        <h2
          className={`mt-0.5 mb-2 text-[19px] leading-[1.3] [overflow-wrap:anywhere] sm:text-[21px] ${a.isRead ? 'font-semibold text-muted' : 'font-bold'}`}
        >
          {link}
        </h2>
        {excerpt && (
          <p className="m-0 line-clamp-4 text-base leading-[1.55] text-fg/75 [overflow-wrap:anywhere]">{excerpt}</p>
        )}
        <span className="mt-1.5 mb-3 ml-auto block w-fit text-sm text-muted">もっと見る</span>
        {thumb && (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="my-3 block max-h-[420px] w-full rounded-2xl bg-hover object-cover"
          />
        )}
        <div className="relative z-[2] my-1 -ml-2.5 flex gap-1 text-muted">
          <button
            type="button"
            onClick={() => onSetRead(a.id, !a.isRead)}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] hover:bg-hover hover:text-fg"
          >
            <Icon name="check" small />
            {a.isRead ? '未読にする' : '既読にする'}
          </button>
          <button
            type="button"
            onClick={copy}
            aria-label="リンクをコピー"
            title="リンクをコピー"
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] hover:bg-hover hover:text-fg"
          >
            <Icon name="share" small />
          </button>
          {actions}
        </div>
      </div>
    </article>
  );
});
