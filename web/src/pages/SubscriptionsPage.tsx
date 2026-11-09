import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { Link } from '@astryxdesign/core/Link';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { api, type Feed, type Folder } from '../api/client';
import { AddFeedDialog } from '../components/AddFeedDialog';
import { PromptDialog } from '../components/Dialogs';
import { Page, PageHeader } from '../components/PageHeader';
import { folderOptions } from '../components/folderOptions';
import { FolderIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon } from '../components/icons';
import { useSubscriptionMutations } from '../hooks/useSubscriptionMutations';
import { buildSections, type Section } from '../utils/subscriptions';
import { decodeEntities } from '../utils/decodeEntities';
import { domainOf, safeHttpUrl } from '../utils/url';

type DialogState =
  | { type: 'addFeed' }
  | { type: 'newFolder' }
  | { type: 'renameFolder'; folder: Folder }
  | { type: 'deleteFolder'; folder: Folder }
  | { type: 'renameFeed'; feed: Feed }
  | { type: 'deleteFeed'; feed: Feed };

// hover / focus-within で表示。タッチ端末とモバイルでは常時表示
const reveal =
  'flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100 [@media(hover:none)]:opacity-100';

function FeedRow(props: {
  feed: Feed;
  unread: number;
  dragging: boolean;
  folders: Folder[];
  onMove: (folder: string | null) => void;
  onRename: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { feed: f, unread } = props;
  const site = safeHttpUrl(f.siteUrl);
  const title = decodeEntities(f.title);
  return (
    <ListItem
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(f.id));
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      className={`group cursor-grab active:cursor-grabbing ${props.dragging ? 'opacity-40' : ''}`}
      startContent={<Avatar name={title} size="md" shape="rounded" tooltip={false} />}
      label={title}
      description={
        site ? (
          <Link href={site} isExternalLink color="secondary" size="sm">
            {domainOf(site)}
          </Link>
        ) : (
          domainOf(f.url)
        )
      }
      endContent={
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <Text type="supporting" hasTabularNumbers>
              {f.articleCount} 件
            </Text>
            {unread > 0 && (
              <Text type="supporting" color="accent" weight="semibold" hasTabularNumbers>
                未読 {unread}
              </Text>
            )}
          </div>
          <div className={reveal}>
            <IconButton size="sm" variant="ghost" label="名前を変更" tooltip="名前を変更" icon={<Icon icon={PencilIcon} />} onClick={props.onRename} />
            <DropdownMenu
              renderTrigger={(t) => (
                <IconButton {...t} size="sm" variant="ghost" label="フォルダへ移動" tooltip="フォルダへ移動" icon={<Icon icon={FolderIcon} />} />
              )}
              alignment="end"
              items={folderOptions(props.folders).map((o) => ({
                label: o.label,
                isDisabled: (f.folder ?? '') === o.value,
                onClick: () => props.onMove(o.value || null),
              }))}
            />
            <IconButton size="sm" variant="ghost" label="削除" tooltip="削除" icon={<Icon icon={TrashIcon} />} onClick={props.onDelete} />
          </div>
        </div>
      }
    />
  );
}

/** フォルダ階層の字下げ。spacing トークン（5 = 20px）を段数倍する。 */
const indent = (depth: number) => ({ paddingInlineStart: `calc(var(--spacing-5) * ${depth})` });

function FolderHeader(props: { section: Section; open: boolean; over: boolean; onToggle: () => void; onRename: () => void; onDelete: () => void }) {
  const s = props.section;
  return (
    <div
      style={indent(s.depth)}
      className={`group flex min-w-0 items-center justify-between gap-2 rounded-md ${props.over ? 'outline-2 outline-offset-4 outline-accent outline-dashed' : ''}`}
    >
      <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className="flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className={`inline-flex text-secondary transition-transform duration-150 ${props.open ? 'rotate-90' : ''}`}>
          <Icon icon="chevronRight" size="sm" />
        </span>
        <Text type="large" weight="semibold" maxLines={1}>
          {s.label}
        </Text>
      </button>
      <Text type="supporting" textWrap="nowrap" hasTabularNumbers>
        {s.total} フィード{s.unread > 0 ? ` · 未読 ${s.unread}` : ''}
      </Text>
      </div>
      {s.folder && (
        <span className={reveal}>
          <IconButton size="sm" variant="ghost" label="フォルダ名を変更" tooltip="フォルダ名を変更" icon={<Icon icon={PencilIcon} />} onClick={props.onRename} />
          <IconButton size="sm" variant="ghost" label="フォルダを削除" tooltip="フォルダを削除" icon={<Icon icon={TrashIcon} />} onClick={props.onDelete} />
        </span>
      )}
    </div>
  );
}

export function SubscriptionsPage() {
  const folders = useQuery({ queryKey: ['folders'], queryFn: api.getFolders });
  const feeds = useQuery({ queryKey: ['feeds'], queryFn: api.getFeeds });
  const unread = useQuery({ queryKey: ['unreadCounts'], queryFn: api.getUnreadCounts });
  const m = useSubscriptionMutations();

  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const folderList = folders.data ?? [];
  const feedList = feeds.data ?? [];
  const sections = buildSections(folderList, feedList, unread.data, q);
  const filtering = q.trim() !== '';
  const ready = feeds.data && folders.data;

  const move = (feed: Feed, folder: string | null) => {
    if (feed.folder !== folder) m.moveFeed.mutate({ id: feed.id, folder });
  };
  const onDrop = (s: Section) => {
    const feed = feedList.find((f) => f.id === dragId);
    setOver(null);
    setDragId(null);
    if (feed) move(feed, s.folder?.name ?? null);
  };
  const close = () => setDialog(null);

  return (
    <Page>
      <PageHeader
        title="購読"
        caption={ready ? `${feedList.length} フィード · ${folderList.length} フォルダ` : ' '}
        actions={
          <>
            <Button label="フォルダ" icon={<Icon icon={PlusIcon} />} onClick={() => setDialog({ type: 'newFolder' })} />
            <Button label="フィードを追加" variant="primary" icon={<Icon icon={PlusIcon} />} onClick={() => setDialog({ type: 'addFeed' })} />
          </>
        }
      />
      <TextInput
        type="search"
        label="絞り込み"
        isLabelHidden
        hasClear
        value={q}
        onChange={setQ}
        placeholder="フィード名・URL で絞り込み"
        startIcon={SearchIcon}
        width="100%"
      />

      {(feeds.isPending || folders.isPending) && (
        <div className="flex flex-col gap-4" role="status" aria-label="読み込み中">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={56} index={i} />
          ))}
        </div>
      )}
      {(feeds.isError || folders.isError) && (
        <div className="py-20">
          <EmptyState title="読み込みに失敗しました" />
        </div>
      )}
      {ready && sections.length === 0 && (
        <div className="py-20">
          <EmptyState
            title={filtering ? '一致するフィードがありません' : 'まだ購読がありません'}
            description={filtering ? undefined : 'サイトの URL を入れるだけでフィードを見つけます。'}
            actions={
              filtering ? undefined : <Button label="フィードを追加" variant="primary" onClick={() => setDialog({ type: 'addFeed' })} />
            }
          />
        </div>
      )}
      {ready && sections.length > 0 && (
        <div className="flex flex-col gap-8">
          {sections.map((s) => {
          const open = filtering || !collapsed[s.key];
          return (
            <section
              key={s.key}
              aria-label={s.folder?.name ?? '未分類'}
              className="flex flex-col gap-3"
              onDragOver={(e) => {
                if (dragId == null) return;
                e.preventDefault();
                setOver(s.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === s.key ? null : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(s);
              }}
            >
              <FolderHeader
                section={s}
                open={open}
                over={over === s.key}
                onToggle={() => setCollapsed((c) => ({ ...c, [s.key]: !c[s.key] }))}
                onRename={() => setDialog({ type: 'renameFolder', folder: s.folder! })}
                onDelete={() => setDialog({ type: 'deleteFolder', folder: s.folder! })}
              />
              {open && (
                <div style={indent(s.depth)} className="border-t border-border">
                  {s.feeds.length > 0 ? (
                    <List edge="flush" hasDividers density="balanced">
                      {s.feeds.map((f) => (
                        <FeedRow
                          key={f.id}
                          feed={f}
                          unread={unread.data?.feeds[String(f.id)] ?? 0}
                          dragging={dragId === f.id}
                          folders={folderList}
                          onMove={(folder) => move(f, folder)}
                          onRename={() => setDialog({ type: 'renameFeed', feed: f })}
                          onDelete={() => setDialog({ type: 'deleteFeed', feed: f })}
                          onDragStart={() => setDragId(f.id)}
                          onDragEnd={() => {
                            setDragId(null);
                            setOver(null);
                          }}
                        />
                      ))}
                    </List>
                  ) : (
                    <div className="py-4">
                      <Text type="supporting">フィードなし（ここへドラッグして移動）</Text>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
        </div>
      )}

      {dialog?.type === 'addFeed' && <AddFeedDialog folders={folderList} onClose={close} />}
      {dialog?.type === 'newFolder' && (
        <PromptDialog
          title="フォルダを追加"
          label="フォルダ名"
          description={'"親/子" と書くと階層になります'}
          okLabel="追加"
          onSubmit={(name) => m.createFolder.mutate(name)}
          onClose={close}
        />
      )}
      {dialog?.type === 'renameFolder' && (
        <PromptDialog
          title="フォルダ名を変更"
          label="フォルダ名"
          value={dialog.folder.name}
          okLabel="変更"
          onSubmit={(name) => m.renameFolder.mutate({ id: dialog.folder.id, name })}
          onClose={close}
        />
      )}
      {dialog?.type === 'renameFeed' && (
        <PromptDialog
          title="フィード名を変更"
          label="フィード名"
          value={decodeEntities(dialog.feed.title)}
          okLabel="変更"
          onSubmit={(title) => m.renameFeed.mutate({ id: dialog.feed.id, title })}
          onClose={close}
        />
      )}
      {dialog?.type === 'deleteFolder' && (
        <AlertDialog
          isOpen
          onOpenChange={(o) => !o && close()}
          title="フォルダを削除"
          description={`「${dialog.folder.name}」を削除します。子フォルダも削除し、中のフィードは未分類へ移動します。`}
          actionLabel="削除"
          cancelLabel="キャンセル"
          onAction={() => {
            m.deleteFolder.mutate(dialog.folder.id);
            close();
          }}
        />
      )}
      {dialog?.type === 'deleteFeed' && (
        <AlertDialog
          isOpen
          onOpenChange={(o) => !o && close()}
          title="フィードを削除"
          description={`「${decodeEntities(dialog.feed.title)}」を削除します。取得済みの記事 ${dialog.feed.articleCount} 件も削除されます。`}
          actionLabel="削除"
          cancelLabel="キャンセル"
          onAction={() => {
            m.deleteFeed.mutate(dialog.feed.id);
            close();
          }}
        />
      )}
    </Page>
  );
}
