import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Feed, type Folder } from '../api/client';
import { Columns } from '../components/Columns';
import { SearchBox } from '../components/SearchBox';
import { Avatar } from '../components/Avatar';
import { Icon, type IconName } from '../components/Icon';
import { AddFeedModal } from '../components/AddFeedModal';
import { ConfirmDialog, PromptDialog, btnCls, btnPri, inputCls } from '../components/Modal';
import { Menu } from '../components/Menu';
import { useSubscriptionMutations } from '../hooks/useSubscriptionMutations';
import { buildSections, type Section } from '../utils/subscriptions';
import { decodeEntities } from '../utils/decodeEntities';
import { domainOf, safeHttpUrl } from '../utils/url';

type Dialog =
  | { type: 'addFeed' }
  | { type: 'newFolder' }
  | { type: 'renameFolder'; folder: Folder }
  | { type: 'deleteFolder'; folder: Folder }
  | { type: 'deleteFeed'; feed: Feed };

const ibCls = 'inline-flex rounded-lg p-[7px] text-muted hover:bg-hover hover:text-fg';
// hover / focus-within で表示。タッチ端末とモバイルでは常時表示
const hactCls =
  'flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100 [@media(hover:none)]:opacity-100';

function IconButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: (el: HTMLElement) => void }) {
  return (
    <button type="button" title={label} aria-label={label} className={ibCls} onClick={(e) => onClick(e.currentTarget)}>
      <Icon name={icon} small />
    </button>
  );
}

function FeedRow(props: {
  feed: Feed;
  unread: number;
  editing: boolean;
  dragging: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onRename: (title: string) => void;
  onMove: (anchor: HTMLElement) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { feed: f, unread } = props;
  const site = safeHttpUrl(f.siteUrl);
  const title = decodeEntities(f.title);
  return (
    <div
      draggable={!props.editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(f.id));
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      className={`group flex min-w-0 cursor-grab items-center gap-2.5 border-b border-line px-3.5 py-3 sm:gap-3 sm:px-5 ${props.dragging ? 'opacity-40' : ''}`}
    >
      <Avatar title={title} size={36} />
      <div className="min-w-0 flex-1">
        <span className="block truncate font-semibold">
          {props.editing ? (
            <input
              autoFocus
              defaultValue={title}
              aria-label="フィード名"
              onFocus={(e) => e.currentTarget.select()}
              onBlur={props.onCancelEdit}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') {
                  const v = e.currentTarget.value.trim();
                  if (v && v !== title) props.onRename(v);
                  else props.onCancelEdit();
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  props.onCancelEdit();
                }
              }}
              className="w-full rounded-md border border-accent bg-bg px-2 py-1 outline-0"
            />
          ) : (
            title
          )}
        </span>
        <span className="block truncate text-[13px] text-muted max-sm:hidden">
          {site ? (
            <a href={site} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">
              {domainOf(site)} ↗
            </a>
          ) : (
            domainOf(f.url)
          )}
        </span>
      </div>
      <div className="text-right text-[12.5px] leading-normal whitespace-nowrap text-muted">
        {f.articleCount} 件
        {unread > 0 && (
          <>
            {' · '}
            <span className="font-semibold text-accent">未読 {unread}</span>
          </>
        )}
      </div>
      <div className={hactCls}>
        <IconButton icon="edit" label="タイトル編集" onClick={props.onEdit} />
        <IconButton icon="folder" label="フォルダ移動" onClick={props.onMove} />
        <IconButton icon="trash" label="削除" onClick={props.onDelete} />
      </div>
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
  const [editId, setEditId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<{ feed: Feed; anchor: HTMLElement } | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const folderList = folders.data ?? [];
  const feedList = feeds.data ?? [];
  const sections = buildSections(folderList, feedList, unread.data, q);
  const filtering = q.trim() !== '';

  const move = (feed: Feed, folder: string | null) => {
    if (feed.folder !== folder) m.moveFeed.mutate({ id: feed.id, folder });
  };
  const onDrop = (s: Section) => {
    const feed = feedList.find((f) => f.id === dragId);
    setOver(null);
    setDragId(null);
    if (feed) move(feed, s.folder?.name ?? null);
  };

  const sortedFolders = [...folderList].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Columns
      center={
        <>
          <div className="flex flex-wrap items-center gap-2.5 px-3.5 pt-6 pb-3 sm:px-5">
            <h1 className="m-0 flex-auto text-[26px] font-bold">
              Subscriptions
              <small className="ml-2 text-[15px] font-medium text-muted">{feedList.length} フィード</small>
            </h1>
            <button type="button" className={btnCls} onClick={() => setDialog({ type: 'newFolder' })}>
              + フォルダ
            </button>
            <button type="button" className={btnPri} onClick={() => setDialog({ type: 'addFeed' })}>
              + フィードを追加
            </button>
          </div>
          <div className="px-3.5 pb-3 sm:px-5">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="フィード名・URL で絞り込み"
              aria-label="絞り込み"
              className={`${inputCls} !rounded-full !px-5 !py-3`}
            />
          </div>
          {(feeds.isPending || folders.isPending) && <div className="py-8 text-center text-sm text-muted">Loading…</div>}
          {(feeds.isError || folders.isError) && (
            <div className="px-5 py-16 text-center text-muted">読み込みに失敗しました。</div>
          )}
          {feeds.data && folders.data && sections.length === 0 && (
            <div className="px-5 py-16 text-center text-muted">
              {filtering ? '一致するフィードがありません。' : 'フィードがありません。'}
            </div>
          )}
          {feeds.data &&
            folders.data &&
            sections.map((s) => {
              const open = filtering || !collapsed[s.key];
              return (
                <section
                  key={s.key}
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
                  <div
                    style={{ paddingLeft: `calc(20px + ${s.depth * 22}px)` }}
                    className={`group flex min-w-0 items-center gap-2 border-y border-line bg-panel py-3 pr-3.5 font-bold sm:pr-5 max-sm:!pl-3.5 ${over === s.key ? 'outline-2 -outline-offset-2 outline-accent outline-dashed' : ''}`}
                  >
                    <button
                      type="button"
                      aria-label="開閉"
                      aria-expanded={open}
                      onClick={() => setCollapsed((c) => ({ ...c, [s.key]: !c[s.key] }))}
                      className={`inline-flex text-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
                    >
                      <Icon name="chev" small />
                    </button>
                    <span className="truncate" title={s.folder?.name}>
                      {s.label}
                    </span>
                    <span className="text-[13px] font-normal whitespace-nowrap text-muted">
                      {s.total} フィード{s.unread > 0 ? ` · 未読 ${s.unread}` : ''}
                    </span>
                    {s.folder && (
                      <span className={`ml-auto ${hactCls}`}>
                        <IconButton
                          icon="edit"
                          label="リネーム"
                          onClick={() => setDialog({ type: 'renameFolder', folder: s.folder! })}
                        />
                        <IconButton
                          icon="trash"
                          label="削除"
                          onClick={() => setDialog({ type: 'deleteFolder', folder: s.folder! })}
                        />
                      </span>
                    )}
                  </div>
                  {open &&
                    (s.feeds.length > 0 ? (
                      s.feeds.map((f) => (
                        <FeedRow
                          key={f.id}
                          feed={f}
                          unread={unread.data?.feeds[String(f.id)] ?? 0}
                          editing={editId === f.id}
                          dragging={dragId === f.id}
                          onEdit={() => setEditId(f.id)}
                          onCancelEdit={() => setEditId(null)}
                          onRename={(title) => {
                            setEditId(null);
                            m.renameFeed.mutate({ id: f.id, title });
                          }}
                          onMove={(anchor) => setMenu({ feed: f, anchor })}
                          onDelete={() => setDialog({ type: 'deleteFeed', feed: f })}
                          onDragStart={() => setDragId(f.id)}
                          onDragEnd={() => {
                            setDragId(null);
                            setOver(null);
                          }}
                        />
                      ))
                    ) : (
                      <div className="border-b border-line px-5 py-3.5 text-sm text-muted">
                        フィードなし（ここへドラッグして移動）
                      </div>
                    ))}
                </section>
              );
            })}

          {menu && (
            <Menu
              anchor={menu.anchor}
              onClose={() => setMenu(null)}
              items={[
                { label: '未分類', onSelect: () => move(menu.feed, null) },
                ...sortedFolders.map((fo) => ({
                  label: '　'.repeat(fo.name.split('/').length - 1) + fo.name,
                  onSelect: () => move(menu.feed, fo.name),
                })),
              ]}
            />
          )}
          {dialog?.type === 'addFeed' && <AddFeedModal folders={folderList} onClose={() => setDialog(null)} />}
          {dialog?.type === 'newFolder' && (
            <PromptDialog
              title="フォルダを追加"
              label={'フォルダ名（"親/子" で階層）'}
              okLabel="追加"
              onSubmit={(name) => m.createFolder.mutate(name)}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog?.type === 'renameFolder' && (
            <PromptDialog
              title="フォルダ名を変更"
              label="フォルダ名"
              value={dialog.folder.name}
              okLabel="変更"
              onSubmit={(name) => m.renameFolder.mutate({ id: dialog.folder.id, name })}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog?.type === 'deleteFolder' && (
            <ConfirmDialog
              title="フォルダを削除"
              message={`「${dialog.folder.name}」を削除します。子フォルダも削除し、中のフィードは未分類へ移動します。`}
              label="削除"
              onConfirm={() => m.deleteFolder.mutate(dialog.folder.id)}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog?.type === 'deleteFeed' && (
            <ConfirmDialog
              title="フィードを削除"
              message={`「${decodeEntities(dialog.feed.title)}」を削除します。取得済みの記事 ${dialog.feed.articleCount} 件も削除されます。`}
              label="削除"
              onConfirm={() => m.deleteFeed.mutate(dialog.feed.id)}
              onClose={() => setDialog(null)}
            />
          )}
        </>
      }
      right={<SearchBox />}
    />
  );
}
