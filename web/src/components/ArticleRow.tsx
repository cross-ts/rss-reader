import { memo, useMemo } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import type { Article } from '../api/client';
import { useToast } from './Toast';
import { CircleIcon, LinkIcon } from './icons';
import { decodeEntities } from '../utils/decodeEntities';
import { extractTextExcerpt, extractThumbnail } from '../utils/thumbnail';
import { formatDate } from '../utils/time';
import { safeHttpUrl } from '../utils/url';

interface Props {
  article: Article;
  onSetRead: (id: number, isRead: boolean) => void;
}

/**
 * タイムラインの 1 行。メタ情報 → 見出し → 抜粋の順に読み下せる編集的な行組み。
 * 行全体が元記事へのリンク（::after で覆う）、操作ボタンだけ上に重ねる。
 */
export const ArticleRow = memo(function ArticleRow({ article: a, onSetRead }: Props) {
  const toast = useToast();
  const thumb = useMemo(() => safeHttpUrl(extractThumbnail(a.content)), [a.content]);
  const excerpt = useMemo(() => extractTextExcerpt(a.content, 200), [a.content]);
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
      toast('コピーに失敗しました', 'error');
    }
  };

  return (
    <article
      data-read={a.isRead || undefined}
      className="group relative flex gap-6 border-b border-border py-7 transition-colors first:border-t"
    >
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex min-w-0 items-center gap-2">
          {!a.isRead && <StatusDot variant="accent" label="未読" />}
          <Text type="label" weight="semibold" maxLines={1} hasTruncateTooltip={false}>
            {feedTitle}
          </Text>
          <Text type="supporting" color="secondary">
            ·
          </Text>
          <Text type="supporting" color="secondary" textWrap="nowrap">
            {formatDate(a.publishedAt)}
          </Text>
          {a.author && (
            <Text type="supporting" color="secondary" maxLines={1} hasTruncateTooltip={false}>
              {decodeEntities(a.author)}
            </Text>
          )}
        </div>
        <Heading level={2} weight={a.isRead ? 'medium' : 'semibold'} color={a.isRead ? 'secondary' : 'primary'} textWrap="pretty">
          <a
            href={href ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={open}
            onAuxClick={(e) => e.button === 1 && open()}
            className="outline-none after:absolute after:inset-0 after:z-[1] after:rounded-md after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-accent group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4"
          >
            {decodeEntities(a.title)}
          </a>
        </Heading>
        {excerpt && (
          <div className="mt-2">
            <Text type="body" color="secondary" as="p" display="block" maxLines={2} hasTruncateTooltip={false} wordBreak="break-word">
              {excerpt}
            </Text>
          </div>
        )}
        <div className="relative z-[2] mt-4 -ml-2 flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            label={a.isRead ? '未読にする' : '既読にする'}
            icon={<Icon icon={a.isRead ? CircleIcon : 'check'} />}
            onClick={() => onSetRead(a.id, !a.isRead)}
          />
          <IconButton size="sm" variant="ghost" label="リンクをコピー" tooltip="リンクをコピー" icon={<Icon icon={LinkIcon} />} onClick={copy} />
        </div>
      </div>
      {thumb && (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mt-1 hidden aspect-[4/3] w-32 flex-none self-start rounded-lg bg-muted object-cover sm:block"
        />
      )}
    </article>
  );
});
