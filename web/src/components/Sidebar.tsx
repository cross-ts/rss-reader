import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Folder, type Feed } from '../api/client';
import { useToast } from './Toast';

export type SidebarSelection =
  | { type: 'newsfeed' }
  | { type: 'folder'; folderId: number; folderName: string }
  | { type: 'feed'; feedId: number };

interface Props {
  selection: SidebarSelection;
  onSelect: (sel: SidebarSelection) => void;
  unreadCounts: { feeds: Map<number, number>; folders: Map<number, number>; total: number };
  railView: 'newsfeed' | 'search' | 'add' | 'settings';
}

export function Sidebar({ selection, onSelect, unreadCounts, railView }: Props) {
  const qc = useQueryClient();
  const { addToast } = useToast();

  const { data: folders = [], isLoading: foldersLoading, isError: foldersError, refetch: refetchFolders } = useQuery({ queryKey: ['folders'], queryFn: api.getFolders });
  const { data: feeds = [], isLoading: feedsLoading, isError: feedsError, refetch: refetchFeeds } = useQuery({ queryKey: ['feeds'], queryFn: api.getFeeds });

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Feed addition form
  const [feedUrl, setFeedUrl] = useState('');
  const [feedFolder, setFeedFolder] = useState('');
  const [newFolderForFeed, setNewFolderForFeed] = useState('');
  const [discoverPreview, setDiscoverPreview] = useState<{ feedUrl: string; title?: string | null } | null>(null);

  // Folder addition
  const [newFolderName, setNewFolderName] = useState('');

  // Deletion tracking
  const [deletingFolderId, setDeletingFolderId] = useState<number | null>(null);
  const [deletingFeedId, setDeletingFeedId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const discoverSeqRef = React.useRef(0);

  const addFeed = useMutation({
    mutationFn: () => {
      const folderName = newFolderForFeed.trim() || feedFolder.trim() || null;
      return api.createFeed(feedUrl.trim(), folderName);
    },
    onSuccess: (feed) => {
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      qc.invalidateQueries({ queryKey: ['articles'] });
      setFeedUrl('');
      setFeedFolder('');
      setNewFolderForFeed('');
      setDiscoverPreview(null);
      addToast(`Feed "${feed.title || feed.url}" added`, 'success');
    },
    onError: (err) => {
      addToast(err instanceof Error ? err.message : 'Failed to add feed', 'error');
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
    onSuccess: (_data, id) => {
      setDeletingFeedId(null);
      setDeleteError(null);
      // If we deleted the currently selected feed, go back to newsfeed
      if (selection.type === 'feed' && selection.feedId === id) {
        onSelect({ type: 'newsfeed' });
      }
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      qc.invalidateQueries({ queryKey: ['articles'] });
      addToast('Feed deleted', 'success');
    },
    onError: (err) => {
      setDeletingFeedId(null);
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete feed');
      addToast('Failed to delete feed', 'error');
    },
  });

  const deleteFolder = useMutation({
    mutationFn: (id: number) => api.deleteFolder(id),
    onSuccess: (_data, id) => {
      setDeletingFolderId(null);
      setDeleteError(null);
      if (selection.type === 'folder' && selection.folderId === id) {
        onSelect({ type: 'newsfeed' });
      }
      qc.invalidateQueries({ queryKey: ['folders'] });
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['articles'] });
      addToast('Folder deleted', 'success');
    },
    onError: (err) => {
      setDeletingFolderId(null);
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete folder');
      addToast('Failed to delete folder', 'error');
    },
  });

  const discoverFeed = useMutation({
    mutationFn: async (url: string) => {
      const seq = ++discoverSeqRef.current;
      const data = await api.discoverFeed(url);
      if (seq !== discoverSeqRef.current) return null;
      return data;
    },
    onSuccess: (data) => {
      if (!data) return;
      setDiscoverPreview(data);
      setFeedUrl(data.feedUrl);
    },
  });

  // Group feeds by folder
  const folderMap = new Map<string | null, Feed[]>();
  for (const feed of feeds) {
    const key = feed.folder;
    if (!folderMap.has(key)) folderMap.set(key, []);
    folderMap.get(key)!.push(feed);
  }

  const folderNames = new Set<string>(folders.map((f: Folder) => f.name));
  for (const feed of feeds) {
    if (feed.folder) folderNames.add(feed.folder);
  }

  const toggleFolder = (name: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

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
      `Delete folder "${folder.name}"?\nFeeds inside will become uncategorized.`
    );
    if (ok) {
      setDeleteError(null);
      setDeletingFolderId(folder.id);
      deleteFolder.mutate(folder.id);
    }
  };

  const handleDeleteFeed = (feed: Feed) => {
    const ok = window.confirm(`Delete feed "${feed.title || feed.url}"?`);
    if (ok) {
      setDeleteError(null);
      setDeletingFeedId(feed.id);
      deleteFeed.mutate(feed.id);
    }
  };

  // Show add-feed panel when rail "add" is active
  const showAddPanel = railView === 'add';

  return (
    <aside className="w-[260px] bg-surface flex flex-col overflow-hidden h-full border-r border-border flex-shrink-0">
      {/* Header */}
      <div className="px-4 py-3 flex-shrink-0">
        <h2 className="text-sm font-semibold text-text-primary tracking-tight">Feeds</h2>
      </div>

      {/* Error display */}
      {deleteError && (
        <div className="mx-3 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-danger">
          {deleteError}
          <button onClick={() => setDeleteError(null)} className="ml-2 text-text-sub hover:text-text-primary">dismiss</button>
        </div>
      )}

      {/* Add feed panel (shown when rail add is active) */}
      {showAddPanel && (
        <div className="px-3 pb-3 border-b border-border flex-shrink-0">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-sub mb-2">
            Add Feed
          </h3>
          <form onSubmit={handleAddFeed} className="flex flex-col gap-2">
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Site or feed URL"
                value={feedUrl}
                onChange={(e) => { setFeedUrl(e.target.value); setDiscoverPreview(null); discoverFeed.reset(); }}
                className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-border rounded-md text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
              <button
                type="button"
                onClick={handleDiscover}
                disabled={discoverFeed.isPending || !feedUrl.trim()}
                className="px-2.5 py-1.5 bg-white border border-border rounded-md text-xs text-text-sub hover:text-text-primary hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {discoverFeed.isPending ? '...' : 'Detect'}
              </button>
            </div>

            {discoverPreview && (
              <div className="px-2.5 py-2 bg-accent-light border border-accent/20 rounded-md text-xs">
                <p className="text-accent font-semibold truncate">{discoverPreview.title ?? '(Untitled)'}</p>
                <p className="text-text-sub truncate text-[11px]">{discoverPreview.feedUrl}</p>
              </div>
            )}
            {discoverFeed.isError && (
              <p className="text-danger text-xs">Feed detection failed</p>
            )}

            <select
              value={feedFolder}
              onChange={(e) => setFeedFolder(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-border rounded-md text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            >
              <option value="">No folder</option>
              {[...folderNames].map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="New folder name (optional)"
              value={newFolderForFeed}
              onChange={(e) => setNewFolderForFeed(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-border rounded-md text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            />
            <button
              type="submit"
              disabled={addFeed.isPending}
              className="px-3 py-1.5 bg-accent text-white rounded-md text-xs font-semibold hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {addFeed.isPending ? 'Adding...' : 'Add Feed'}
            </button>
            {addFeed.isError && <p className="text-danger text-xs">Failed to add feed</p>}
          </form>

          {/* Folder creation */}
          <div className="mt-3 pt-3 border-t border-border">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-sub mb-2">
              Create Folder
            </h3>
            <form onSubmit={handleAddFolder} className="flex gap-1.5">
              <input
                type="text"
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                required
                className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-border rounded-md text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
              <button
                type="submit"
                disabled={addFolder.isPending}
                className="px-3 py-1.5 bg-white border border-border rounded-md text-xs text-text-sub hover:text-text-primary hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {addFolder.isPending ? '...' : 'Create'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Feed tree */}
      <nav className="flex-1 py-1 overflow-y-auto" aria-label="Feed navigation">
        {/* Loading state */}
        {(foldersLoading || feedsLoading) && (
          <div className="px-4 py-6 text-center">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-[11px] text-text-sub">Loading feeds...</p>
          </div>
        )}

        {/* Error state */}
        {(foldersError || feedsError) && !foldersLoading && !feedsLoading && (
          <div className="px-4 py-6 text-center">
            <p className="text-[11px] text-danger mb-2">Failed to load feeds</p>
            <button
              onClick={() => { refetchFolders(); refetchFeeds(); }}
              className="px-3 py-1.5 bg-accent text-white text-[11px] rounded-lg hover:bg-accent-hover transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {/* Newsfeed (all articles) */}
        {!foldersLoading && !feedsLoading && (<>
        <button
          className={[
            'w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
            selection.type === 'newsfeed'
              ? 'bg-accent-light text-accent font-semibold'
              : 'text-text-primary hover:bg-surface-2',
          ].join(' ')}
          onClick={() => onSelect({ type: 'newsfeed' })}
          aria-current={selection.type === 'newsfeed' ? 'page' : undefined}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
          <span className="flex-1 truncate">All Articles</span>
          {unreadCounts.total > 0 && (
            <span className="flex-shrink-0 bg-accent text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {unreadCounts.total > 999 ? '999+' : unreadCounts.total}
            </span>
          )}
        </button>

        {/* Uncategorized feeds */}
        {(folderMap.get(null) ?? []).map((feed) => (
          <FeedRow
            key={feed.id}
            feed={feed}
            selected={selection.type === 'feed' && selection.feedId === feed.id}
            onSelect={() => onSelect({ type: 'feed', feedId: feed.id })}
            onDelete={() => handleDeleteFeed(feed)}
            deleting={deletingFeedId === feed.id}
            unreadCount={unreadCounts.feeds.get(feed.id) ?? 0}
            indent={false}
          />
        ))}

        {/* Folders */}
        {folders.map((folder: Folder) => {
          const isExpanded = expandedFolders.has(folder.name);
          const folderFeeds = folderMap.get(folder.name) ?? [];
          const folderSelected = selection.type === 'folder' && selection.folderId === folder.id;
          const folderUnread = unreadCounts.folders.get(folder.id) ?? 0;

          return (
            <div key={folder.id}>
              <div className={[
                'flex items-center group transition-colors',
                folderSelected
                  ? 'bg-accent-light'
                  : 'hover:bg-surface-2',
              ].join(' ')}>
                {/* Expand/collapse chevron */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFolder(folder.name); }}
                  className="flex-shrink-0 w-6 h-8 ml-2 flex items-center justify-center text-text-sub hover:text-text-primary"
                >
                  <svg
                    className={['w-3 h-3 transition-transform', isExpanded ? 'rotate-90' : ''].join(' ')}
                    fill="currentColor" viewBox="0 0 20 20"
                  >
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
                {/* Folder name button */}
                <button
                  className={[
                    'flex-1 flex items-center gap-1.5 pr-1 py-2 text-left text-[13px]',
                    folderSelected
                      ? 'text-accent font-semibold'
                      : 'text-text-primary',
                  ].join(' ')}
                  onClick={() => {
                    onSelect({ type: 'folder', folderId: folder.id, folderName: folder.name });
                    if (!isExpanded) {
                      setExpandedFolders((prev) => new Set(prev).add(folder.name));
                    }
                  }}
                >
                  <svg className="w-4 h-4 flex-shrink-0 text-text-sub" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                  <span className="flex-1 truncate">{folder.name}</span>
                  {folderUnread > 0 && (
                    <span className="flex-shrink-0 bg-text-sub/10 text-text-sub text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {folderUnread > 999 ? '999+' : folderUnread}
                    </span>
                  )}
                </button>
                <button
                  className="flex-shrink-0 mr-2 w-6 h-6 flex items-center justify-center text-[11px] text-text-sub opacity-0 group-hover:opacity-100 hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed transition-all rounded hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  onClick={() => handleDeleteFolder(folder)}
                  disabled={deletingFolderId === folder.id}
                  aria-label={`Delete folder "${folder.name}"`}
                >
                  {deletingFolderId === folder.id ? '...' : '✕'}
                </button>
              </div>

              {/* Expanded feeds */}
              {isExpanded && folderFeeds.map((feed) => (
                <FeedRow
                  key={feed.id}
                  feed={feed}
                  selected={selection.type === 'feed' && selection.feedId === feed.id}
                  onSelect={() => onSelect({ type: 'feed', feedId: feed.id })}
                  onDelete={() => handleDeleteFeed(feed)}
                  deleting={deletingFeedId === feed.id}
                  unreadCount={unreadCounts.feeds.get(feed.id) ?? 0}
                  indent={true}
                />
              ))}
            </div>
          );
        })}
        </>)}
      </nav>

      {/* Settings info panel */}
      {railView === 'settings' && (
        <div className="px-4 py-3 border-t border-border flex-shrink-0 bg-white">
          <h3 className="text-xs font-semibold text-text-primary mb-1">RSS Reader</h3>
          <p className="text-[11px] text-text-sub leading-relaxed">
            Lightweight RSS reader with local read tracking.
            Built with React, Vite, and Tailwind CSS.
          </p>
        </div>
      )}
    </aside>
  );
}

interface FeedRowProps {
  feed: Feed;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  deleting: boolean;
  unreadCount: number;
  indent: boolean;
}

function FeedRow({ feed, selected, onSelect, onDelete, deleting, unreadCount, indent }: FeedRowProps) {
  return (
    <div
      className={[
        'flex items-center group transition-colors',
        selected
          ? 'bg-accent-light'
          : 'hover:bg-surface-2',
      ].join(' ')}
    >
      <button
        className={[
          'flex-1 flex items-center gap-2 py-1.5 text-left text-[13px] min-w-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
          indent ? 'pl-10 pr-1' : 'pl-4 pr-1',
          selected ? 'text-accent font-medium' : 'text-text-primary',
        ].join(' ')}
        onClick={onSelect}
        aria-current={selected ? 'page' : undefined}
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-orange-400" />
        <span className="truncate">{feed.title || feed.url}</span>
        {unreadCount > 0 && (
          <span className="flex-shrink-0 text-text-sub text-[10px] font-medium ml-auto mr-1">
            {unreadCount > 999 ? '999+' : unreadCount}
          </span>
        )}
      </button>
      <button
        className="flex-shrink-0 mr-2 w-6 h-6 flex items-center justify-center text-[11px] text-text-sub opacity-0 group-hover:opacity-100 hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed transition-all rounded hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        disabled={deleting}
        aria-label={`Delete feed "${feed.title || feed.url}"`}
      >
        {deleting ? '...' : '✕'}
      </button>
    </div>
  );
}
