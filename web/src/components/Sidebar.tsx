import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Folder, type Feed, type FeedCandidate } from '../api/client';
import { useToast } from './Toast';

export type SidebarSelection =
  | { type: 'newsfeed' }
  | { type: 'folder'; folderId: number; folderName: string }
  | { type: 'feed'; feedId: number };

interface Props {
  selection: SidebarSelection;
  onSelect: (sel: SidebarSelection) => void;
  unreadCounts: { feeds: Record<string, number>; folders: Record<string, number>; total: number };
  onFeedAdding?: (feedTitle: string | null) => void;
  addPanelFocusToken?: number;
  openAddPanelToken?: number;
}

const deleteButtonClassName = [
  'flex-shrink-0 mr-2 w-6 h-6 flex items-center justify-center text-[11px] text-text-sub',
  'opacity-100 md:opacity-0 md:pointer-events-none',
  'md:group-hover:opacity-100 md:group-hover:pointer-events-auto',
  'hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed',
  'transition-all rounded hover:bg-surface-2',
  'focus-visible:opacity-100 md:focus-visible:pointer-events-auto',
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
].join(' ');

export function Sidebar({ selection, onSelect, unreadCounts, onFeedAdding, addPanelFocusToken = 0, openAddPanelToken = 0 }: Props) {
  const qc = useQueryClient();
  const { addToast } = useToast();

  // Local panel visibility state
  const [showAddPanel, setShowAddPanel] = useState(false);

  const { data: folders = [], isLoading: foldersLoading, isError: foldersError, refetch: refetchFolders } = useQuery({ queryKey: ['folders'], queryFn: api.getFolders });
  const { data: feeds = [], isLoading: feedsLoading, isError: feedsError, refetch: refetchFeeds } = useQuery({ queryKey: ['feeds'], queryFn: api.getFeeds });

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Feed addition form
  const [feedUrl, setFeedUrl] = useState('');
  const [feedFolder, setFeedFolder] = useState('');
  const [newFolderForFeed, setNewFolderForFeed] = useState('');
  const [discoverPreview, setDiscoverPreview] = useState<FeedCandidate[] | null>(null);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0);
  const [addFeedResult, setAddFeedResult] = useState<Feed | null>(null);
  const [isResolvingFeed, setIsResolvingFeed] = useState(false);

  // Folder addition
  const [newFolderName, setNewFolderName] = useState('');

  // Deletion tracking
  const [deletingFolderId, setDeletingFolderId] = useState<number | null>(null);
  const [deletingFeedId, setDeletingFeedId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    type: 'feed' | 'folder';
    id: number;
    name: string;
  } | null>(null);

  const discoverSeqRef = useRef(0);
  const addFeedInputRef = useRef<HTMLInputElement | null>(null);

  const addFeed = useMutation({
    mutationFn: async ({ candidateURL, candidateTitle }: { candidateURL: string; candidateTitle: string }) => {
      const folderName = newFolderForFeed.trim() || feedFolder.trim() || null;
      onFeedAdding?.(candidateTitle);
      return api.createFeed(candidateURL, folderName);
    },
    onSuccess: async (feed) => {
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      setAddFeedResult(feed);
      setFeedUrl('');
      setFeedFolder('');
      setNewFolderForFeed('');
      setDiscoverPreview(null);
      setSelectedCandidateIndex(0);
      addToast(`Feed "${feed.title || feed.url}" added`, 'success');
      // 記事クエリの再取得が完了してから「追加中」表示を解除し、
      // 一瞬 "No articles found" が出るのを防ぐ
      await qc.invalidateQueries({ queryKey: ['articles'] });
      onFeedAdding?.(null);
    },
    onError: (err) => {
      onFeedAdding?.(null);
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
    const inputURL = feedUrl.trim();
    if (!inputURL) return;

    if (discoverPreview && discoverPreview.length > 1) {
      const selectedCandidate = discoverPreview[selectedCandidateIndex];
      if (!selectedCandidate) return;
      setAddFeedResult(null);
      addFeed.mutate({
        candidateURL: selectedCandidate.feedUrl,
        candidateTitle: selectedCandidate.title ?? selectedCandidate.feedUrl,
      });
      return;
    }

    setAddFeedResult(null);
    setDiscoverPreview(null);
    setSelectedCandidateIndex(0);
    const seq = ++discoverSeqRef.current;
    setIsResolvingFeed(true);
    api.discoverFeed(inputURL)
      .then((candidates) => {
        if (seq !== discoverSeqRef.current) return;
        if (candidates.length > 1) {
          setIsResolvingFeed(false);
          setDiscoverPreview(candidates);
          return;
        }

        const candidate = candidates[0];
        setIsResolvingFeed(false);
        addFeed.mutate({
          candidateURL: candidate?.feedUrl ?? inputURL,
          candidateTitle: candidate?.title ?? inputURL,
        });
      })
      .catch((err: unknown) => {
        if (seq !== discoverSeqRef.current) return;
        setIsResolvingFeed(false);
        addToast(err instanceof Error ? err.message : 'Failed to detect feed', 'error');
      });
  };

  const handleAddFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    addFolder.mutate();
  };

  const handleDeleteFolder = (folder: Folder) => {
    setConfirmModal({ type: 'folder', id: folder.id, name: folder.name });
  };

  const handleDeleteFeed = (feed: Feed) => {
    setConfirmModal({ type: 'feed', id: feed.id, name: feed.title || feed.url });
  };

  const handleConfirmDelete = () => {
    if (!confirmModal) return;
    setDeleteError(null);
    if (confirmModal.type === 'folder') {
      setDeletingFolderId(confirmModal.id);
      deleteFolder.mutate(confirmModal.id);
    } else {
      setDeletingFeedId(confirmModal.id);
      deleteFeed.mutate(confirmModal.id);
    }
    setConfirmModal(null);
  };

  const isCreatingFeed = addFeed.isPending;
  const isAddFeedBusy = isResolvingFeed || isCreatingFeed;

  // Open add panel when parent increments the token
  useEffect(() => {
    if (openAddPanelToken > 0) {
      setShowAddPanel(true);
    }
  }, [openAddPanelToken]);

  // Focus the add feed input when the panel opens or focus token changes
  useEffect(() => {
    if (showAddPanel) {
      requestAnimationFrame(() => addFeedInputRef.current?.focus());
    }
  }, [showAddPanel, addPanelFocusToken]);

  return (
    <>
    {confirmModal && (
      <ConfirmDeleteModal
        type={confirmModal.type}
        name={confirmModal.name}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmModal(null)}
      />
    )}
    <aside className="w-[260px] bg-surface flex flex-col overflow-hidden h-full border-r border-border flex-shrink-0">
      {/* Header */}
      <div className="px-4 py-3 flex-shrink-0 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary tracking-tight">Feeds</h2>
        <div className="flex items-center gap-1">
          {/* Add feed button */}
          <button
            onClick={() => { setShowAddPanel((p) => !p); }}
            title="Add feed"
            aria-label="Add feed"
            aria-pressed={showAddPanel}
            className={[
              'w-7 h-7 flex items-center justify-center rounded-md transition-colors',
              showAddPanel
                ? 'text-accent bg-accent-light'
                : 'text-text-sub hover:text-text-primary hover:bg-surface-2',
            ].join(' ')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
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
                ref={addFeedInputRef}
                type="text"
                placeholder="Site or feed URL"
                value={feedUrl}
                onChange={(e) => {
                  setFeedUrl(e.target.value);
                  discoverSeqRef.current++;
                  setDiscoverPreview(null);
                  setSelectedCandidateIndex(0);
                  setAddFeedResult(null);
                  setIsResolvingFeed(false);
                  if (!addFeed.isPending) {
                    addFeed.reset();
                  }
                }}
                disabled={isCreatingFeed}
                className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-border rounded-md text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
            </div>

            {discoverPreview && discoverPreview.length > 1 && (
              <div className="flex flex-col gap-1">
                <p className="text-[11px] text-text-sub">{discoverPreview.length} feeds found. Select one to continue.</p>
                {discoverPreview.map((candidate, i) => (
                  <button
                    key={`${i}-${candidate.feedUrl}`}
                    type="button"
                    aria-pressed={i === selectedCandidateIndex}
                    onClick={() => {
                      setSelectedCandidateIndex(i);
                    }}
                    className={[
                      'w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors',
                      i === selectedCandidateIndex
                        ? 'bg-accent-light border border-accent/20'
                        : 'bg-white border border-border hover:border-accent/20',
                    ].join(' ')}
                  >
                    <p className="font-semibold truncate">{candidate.title ?? '(Untitled)'}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {candidate.type && (
                        <span className="flex-shrink-0 text-[10px] font-semibold text-accent bg-accent/10 px-1 py-0.5 rounded">
                          {feedTypeLabel(candidate.type)}
                        </span>
                      )}
                      <span className="truncate text-[11px] text-text-sub">{candidate.feedUrl}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {addFeedResult && (
              <div className="px-2.5 py-2 bg-emerald-50 border border-emerald-200 rounded-md text-xs">
                <p className="text-emerald-800 font-semibold truncate">{addFeedResult.title || addFeedResult.url}</p>
                <p className="text-emerald-700/80 truncate text-[11px]">{addFeedResult.url}</p>
                <p className="text-emerald-800 mt-1">
                  {addFeedResult.articleCount} article{addFeedResult.articleCount === 1 ? '' : 's'} fetched
                </p>
              </div>
            )}

            <select
              value={feedFolder}
              onChange={(e) => setFeedFolder(e.target.value)}
              disabled={isCreatingFeed}
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
              disabled={isCreatingFeed}
              className="w-full px-2.5 py-1.5 bg-white border border-border rounded-md text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            />
            <button
              type="submit"
              disabled={isAddFeedBusy}
              className="px-3 py-1.5 bg-accent text-white rounded-md text-xs font-semibold hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isAddFeedBusy ? 'Adding...' : discoverPreview && discoverPreview.length > 1 ? 'Add Selected Feed' : 'Add Feed'}
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
            unreadCount={unreadCounts.feeds[String(feed.id)] ?? 0}
            indent={false}
          />
        ))}

        {/* Folders */}
        {folders.map((folder: Folder) => {
          const isExpanded = expandedFolders.has(folder.name);
          const folderFeeds = folderMap.get(folder.name) ?? [];
          const folderSelected = selection.type === 'folder' && selection.folderId === folder.id;
          const folderUnread = unreadCounts.folders[String(folder.id)] ?? 0;

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
                  className={deleteButtonClassName}
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
                  unreadCount={unreadCounts.feeds[String(feed.id)] ?? 0}
                  indent={true}
                />
              ))}
            </div>
          );
        })}
        </>)}
      </nav>

    </aside>
    </>
  );
}

function feedTypeLabel(mimeType: string): string {
  if (mimeType.includes('rss')) return 'RSS';
  if (mimeType.includes('atom')) return 'Atom';
  if (mimeType.includes('json')) return 'JSON';
  return '';
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
        className={deleteButtonClassName}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        disabled={deleting}
        aria-label={`Delete feed "${feed.title || feed.url}"`}
      >
        {deleting ? '...' : '✕'}
      </button>
    </div>
  );
}

interface ConfirmDeleteModalProps {
  type: 'feed' | 'folder';
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDeleteModal({ type, name, onConfirm, onCancel }: ConfirmDeleteModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const isFeed = type === 'feed';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center help-overlay-backdrop"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-desc"
      >
        <h2 id="confirm-modal-title" className="text-sm font-semibold text-text-primary mb-1">
          {isFeed ? 'Unsubscribe from this feed?' : 'Delete this folder?'}
        </h2>
        <p className="text-xs font-medium text-text-primary mb-3 truncate">
          {name}
        </p>
        <p id="confirm-modal-desc" className="text-xs text-text-sub mb-5">
          {isFeed
            ? 'Saved articles and read status will also be deleted. This action cannot be undone.'
            : 'Feeds inside will become uncategorized. This action cannot be undone.'}
        </p>
        <div className="flex justify-end gap-2">
          <button
            autoFocus
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-text-primary bg-white border border-border rounded-lg hover:bg-surface-2 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-xs font-semibold text-white bg-danger rounded-lg hover:bg-danger-hover transition-colors focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none"
          >
            {isFeed ? 'Unsubscribe' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
