import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Folder, type Feed } from '../api/client';

interface Props {
  selectedFolderId: number | null;
  selectedFeedId: number | null;
  onSelectFolder: (id: number | null) => void;
  onSelectFeed: (id: number | null) => void;
}

export function Sidebar({ selectedFolderId, selectedFeedId, onSelectFolder, onSelectFeed }: Props) {
  const qc = useQueryClient();

  const { data: folders = [] } = useQuery({ queryKey: ['folders'], queryFn: api.getFolders });
  const { data: feeds = [] } = useQuery({ queryKey: ['feeds'], queryFn: api.getFeeds });

  // フィード追加フォーム
  const [feedUrl, setFeedUrl] = useState('');
  const [feedFolder, setFeedFolder] = useState('');
  const [newFolderForFeed, setNewFolderForFeed] = useState('');

  // フォルダ追加フォーム
  const [newFolderName, setNewFolderName] = useState('');

  // フィード検出プレビュー
  const [discoverPreview, setDiscoverPreview] = useState<{ feedUrl: string; title?: string | null } | null>(null);

  // 削除中フォルダIDを追跡（どのフォルダの操作中かを識別するため）
  const [deletingFolderId, setDeletingFolderId] = useState<number | null>(null);
  const [deleteFolderError, setDeleteFolderError] = useState<{ id: number; message: string } | null>(null);

  const addFeed = useMutation({
    mutationFn: () => {
      const folderName = newFolderForFeed.trim() || feedFolder.trim() || null;
      return api.createFeed(feedUrl.trim(), folderName);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      setFeedUrl('');
      setFeedFolder('');
      setNewFolderForFeed('');
      setDiscoverPreview(null);
    },
  });

  const addFolder = useMutation({
    mutationFn: () => api.createFolder(newFolderName.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders'] });
      setNewFolderName('');
    },
  });

  const deleteFeed = useMutation({
    mutationFn: (id: number) => api.deleteFeed(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
    },
  });

  const deleteFolder = useMutation({
    mutationFn: (id: number) => api.deleteFolder(id),
    onSuccess: (_data, id) => {
      // 修正1: 削除したフォルダが現在選択中なら選択を解除
      if (selectedFolderId === id) {
        onSelectFolder(null);
      }
      setDeletingFolderId(null);
      setDeleteFolderError(null);
      qc.invalidateQueries({ queryKey: ['folders'] });
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['articles'] });
    },
    onError: (err, id) => {
      // 修正2: 削除失敗時にどのフォルダのエラーか記録
      setDeletingFolderId(null);
      setDeleteFolderError({ id, message: err instanceof Error ? err.message : '削除に失敗しました' });
    },
  });

  // 修正4: 最新リクエストのみ反映するためのカウンタ
  const discoverSeqRef = React.useRef(0);

  const discoverFeed = useMutation({
    mutationFn: async (url: string) => {
      const seq = ++discoverSeqRef.current;
      const data = await api.discoverFeed(url);
      // 古いレスポンスは捨てる
      if (seq !== discoverSeqRef.current) return null;
      return data;
    },
    onSuccess: (data) => {
      if (!data) return;
      setDiscoverPreview(data);
      setFeedUrl(data.feedUrl);
    },
  });

  // フォルダ別にフィードをグループ化
  const folderMap = new Map<string | null, Feed[]>();
  for (const feed of feeds) {
    const key = feed.folder;
    if (!folderMap.has(key)) folderMap.set(key, []);
    folderMap.get(key)!.push(feed);
  }

  // フォルダ名セット（API から取得したフォルダ + フィードに付いているフォルダ）
  const folderNames = new Set<string>(folders.map((f: Folder) => f.name));
  for (const feed of feeds) {
    if (feed.folder) folderNames.add(feed.folder);
  }

  const handleAddFeed = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedUrl.trim()) return;
    addFeed.mutate();
  };

  const handleAddFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    addFolder.mutate();
  };

  const handleDiscover = () => {
    if (!feedUrl.trim()) return;
    discoverFeed.mutate(feedUrl.trim());
  };

  const handleDeleteFolder = (folder: Folder) => {
    const ok = window.confirm(
      `フォルダ「${folder.name}」を削除しますか？\n（フォルダ内のフィードは未分類になります）`
    );
    if (ok) {
      setDeleteFolderError(null);
      setDeletingFolderId(folder.id);
      deleteFolder.mutate(folder.id);
    }
  };

  return (
    <aside className="bg-surface border-r border-border flex flex-col overflow-y-auto overflow-x-hidden h-screen">
      {/* ヘッダー */}
      <div className="px-4 py-4 border-b border-border flex-shrink-0">
        <h2 className="text-base font-bold text-accent tracking-tight">RSS reader</h2>
      </div>

      {/* フィード追加 */}
      <section className="px-3 py-3 border-b border-border flex-shrink-0">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-text-sub mb-2">
          フィード追加
        </h3>
        <form onSubmit={handleAddFeed} className="flex flex-col gap-1.5">
          <div className="flex gap-1">
            <input
              type="text"
              placeholder="サイト or フィードURL"
              value={feedUrl}
              onChange={(e) => { setFeedUrl(e.target.value); setDiscoverPreview(null); discoverFeed.reset(); }}
              className="flex-1 min-w-0 px-2 py-1.5 bg-surface-2 border border-border rounded text-xs font-mono text-text-primary placeholder-text-sub focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={handleDiscover}
              disabled={discoverFeed.isPending || !feedUrl.trim()}
              className="px-2 py-1.5 bg-surface-3 border border-border rounded text-xs text-text-sub hover:text-text-primary hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {discoverFeed.isPending ? '…' : '検出'}
            </button>
          </div>

          {/* 検出プレビュー */}
          {discoverPreview && (
            <div className="px-2 py-1.5 bg-surface-3 border border-accent/30 rounded text-xs">
              <p className="text-accent font-semibold truncate">{discoverPreview.title ?? '（タイトルなし）'}</p>
              <p className="font-mono text-text-sub truncate">{discoverPreview.feedUrl}</p>
            </div>
          )}
          {discoverFeed.isError && (
            <p className="text-danger text-xs">フィード検出に失敗しました</p>
          )}

          <select
            value={feedFolder}
            onChange={(e) => setFeedFolder(e.target.value)}
            className="w-full px-2 py-1.5 bg-surface-2 border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">フォルダなし</option>
            {[...folderNames].map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="新規フォルダ名（任意）"
            value={newFolderForFeed}
            onChange={(e) => setNewFolderForFeed(e.target.value)}
            className="w-full px-2 py-1.5 bg-surface-2 border border-border rounded text-xs text-text-primary placeholder-text-sub focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={addFeed.isPending}
            className="px-3 py-1.5 bg-accent text-bg rounded text-xs font-semibold hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {addFeed.isPending ? '追加中…' : '追加'}
          </button>
          {addFeed.isError && <p className="text-danger text-xs">追加に失敗しました</p>}
        </form>
      </section>

      {/* フォルダ追加 */}
      <section className="px-3 py-3 border-b border-border flex-shrink-0">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-text-sub mb-2">
          フォルダ追加
        </h3>
        <form onSubmit={handleAddFolder} className="flex gap-1.5">
          <input
            type="text"
            placeholder="フォルダ名"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            required
            className="flex-1 min-w-0 px-2 py-1.5 bg-surface-2 border border-border rounded text-xs text-text-primary placeholder-text-sub focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={addFolder.isPending}
            className="px-3 py-1.5 bg-surface-3 border border-border rounded text-xs text-text-sub hover:text-text-primary hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {addFolder.isPending ? '…' : '追加'}
          </button>
        </form>
      </section>

      {/* フィードツリー */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {/* フォルダなしのフィード */}
        {(folderMap.get(null) ?? []).length > 0 && (
          <div className="mb-1">
            <div className="px-4 py-1.5 text-xs font-semibold text-text-sub">
              未分類
            </div>
            {(folderMap.get(null) ?? []).map((feed) => (
              <FeedItem
                key={feed.id}
                feed={feed}
                selected={selectedFeedId === feed.id}
                onSelect={() => { onSelectFolder(null); onSelectFeed(feed.id); }}
                onDelete={() => deleteFeed.mutate(feed.id)}
              />
            ))}
          </div>
        )}

        {/* フォルダ別 */}
        {folders.map((folder: Folder) => {
          const isFolderDeleting = deletingFolderId === folder.id;
          const folderError = deleteFolderError?.id === folder.id ? deleteFolderError.message : null;
          return (
          <div key={folder.id} className="mb-1">
            <div className="flex items-center group">
              <button
                className={[
                  'flex-1 flex items-center gap-1.5 px-4 py-1.5 text-left text-xs font-semibold text-text-primary hover:bg-surface-3 transition-colors',
                  selectedFolderId === folder.id && selectedFeedId === null
                    ? 'bg-surface-3 border-l-2 border-accent pl-[14px]'
                    : '',
                ].join(' ')}
                onClick={() => { onSelectFolder(folder.id); onSelectFeed(null); }}
              >
                <span className="truncate">&#x1F4C1; {folder.name}</span>
                <span className="ml-auto flex-shrink-0 bg-surface-3 text-text-sub text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                  {folder.feedCount}
                </span>
              </button>
              {/* フォルダ削除ボタン — isPending 中は disabled で連打防止 */}
              <button
                className="flex-shrink-0 mr-2 px-1.5 py-1 text-[10px] text-text-sub opacity-0 group-hover:opacity-100 hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                onClick={() => handleDeleteFolder(folder)}
                disabled={isFolderDeleting}
                title={`フォルダ「${folder.name}」を削除（フィードは未分類になります）`}
              >
                {isFolderDeleting ? '…' : '✕'}
              </button>
            </div>
            {/* 削除失敗エラー表示 */}
            {folderError && (
              <p className="px-4 py-0.5 text-[10px] text-danger">{folderError}</p>
            )}
            {(folderMap.get(folder.name) ?? []).map((feed) => (
              <FeedItem
                key={feed.id}
                feed={feed}
                selected={selectedFeedId === feed.id}
                onSelect={() => { onSelectFolder(null); onSelectFeed(feed.id); }}
                onDelete={() => deleteFeed.mutate(feed.id)}
              />
            ))}
          </div>
          );
        })}
      </nav>
    </aside>
  );
}

interface FeedItemProps {
  feed: Feed;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function FeedItem({ feed, selected, onSelect, onDelete }: FeedItemProps) {
  return (
    <div
      className={[
        'flex items-center pl-6 group hover:bg-surface-3 transition-colors',
        selected ? 'bg-surface-3 border-l-2 border-accent pl-[22px]' : '',
      ].join(' ')}
    >
      <button
        className="flex-1 flex items-center gap-1.5 px-2 py-1.5 text-left text-xs text-text-primary min-w-0"
        onClick={onSelect}
      >
        <span className="truncate">{feed.title || feed.url}</span>
        <span className="ml-auto flex-shrink-0 bg-surface-3 text-text-sub text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
          {feed.articleCount}
        </span>
      </button>
      <button
        className="flex-shrink-0 mr-2 px-1.5 py-1 text-[10px] text-text-sub opacity-0 group-hover:opacity-100 hover:text-danger transition-all"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="フィードを削除"
      >
        ✕
      </button>
    </div>
  );
}
