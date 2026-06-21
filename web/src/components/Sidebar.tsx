import { useState } from 'react';
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

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>RSSリーダー</h2>
      </div>

      {/* フィード追加 */}
      <section className="sidebar-section">
        <h3>フィード追加</h3>
        <form onSubmit={handleAddFeed} className="add-form">
          <input
            type="url"
            placeholder="フィードURL"
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            required
          />
          <select value={feedFolder} onChange={(e) => setFeedFolder(e.target.value)}>
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
          />
          <button type="submit" disabled={addFeed.isPending}>
            {addFeed.isPending ? '追加中…' : '追加'}
          </button>
          {addFeed.isError && <p className="error">追加に失敗しました</p>}
        </form>
      </section>

      {/* フォルダ追加 */}
      <section className="sidebar-section">
        <h3>フォルダ追加</h3>
        <form onSubmit={handleAddFolder} className="add-form">
          <input
            type="text"
            placeholder="フォルダ名"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            required
          />
          <button type="submit" disabled={addFolder.isPending}>
            {addFolder.isPending ? '追加中…' : '追加'}
          </button>
        </form>
      </section>

      {/* フィードツリー */}
      <nav className="feed-tree">
        {/* フォルダなしのフィード */}
        {(folderMap.get(null) ?? []).length > 0 && (
          <div className="folder-group">
            <div className="folder-label uncategorized">未分類</div>
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
        {folders.map((folder: Folder) => (
          <div key={folder.id} className="folder-group">
            <button
              className={`folder-label${selectedFolderId === folder.id && selectedFeedId === null ? ' selected' : ''}`}
              onClick={() => { onSelectFolder(folder.id); onSelectFeed(null); }}
            >
              📁 {folder.name}
              <span className="badge">{folder.feedCount}</span>
            </button>
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
        ))}
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
    <div className={`feed-item${selected ? ' selected' : ''}`}>
      <button className="feed-name" onClick={onSelect}>
        {feed.title || feed.url}
        <span className="badge">{feed.articleCount}</span>
      </button>
      <button
        className="delete-btn"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="削除"
      >
        ✕
      </button>
    </div>
  );
}
