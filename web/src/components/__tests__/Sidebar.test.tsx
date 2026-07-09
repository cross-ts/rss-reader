import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar, type SidebarSelection } from '../Sidebar';
import { api, type Feed, type Folder } from '../../api/client';

// Mock the API module
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual('../../api/client');
  return {
    ...actual,
    api: {
      getFolders: vi.fn(),
      getFeeds: vi.fn(),
      createFeed: vi.fn(),
      createFolder: vi.fn(),
      deleteFeed: vi.fn(),
      deleteFolder: vi.fn(),
      discoverFeed: vi.fn(),
      updateFeed: vi.fn(),
    },
  };
});

// Mock useToast
vi.mock('../Toast', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn() })),
}));

const mockApi = vi.mocked(api);

const testFeeds: Feed[] = [
  { id: 1, title: 'Tech Blog', url: 'https://tech.com/feed', siteUrl: 'https://tech.com', folder: null, articleCount: 10 },
  { id: 2, title: 'News Feed', url: 'https://news.com/feed', siteUrl: 'https://news.com', folder: 'Tech', articleCount: 5 },
  { id: 3, title: 'Design Blog', url: 'https://design.com/feed', siteUrl: 'https://design.com', folder: 'Design', articleCount: 3 },
];

const testFolders: Folder[] = [
  { id: 100, name: 'Tech', feedCount: 1 },
  { id: 200, name: 'Design', feedCount: 1 },
];

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const defaultProps = {
  selection: { type: 'newsfeed' } as SidebarSelection,
  onSelect: vi.fn(),
  unreadCounts: {
    feeds: { '1': 3, '2': 5 },
    folders: { '100': 5 },
    total: 8,
  },
};

const FEED_DND_TYPE = 'application/x-rss-reader-feed-id';

// Minimal DataTransfer stub for jsdom, which doesn't implement drag & drop.
function createDataTransferStub() {
  const store = new Map<string, string>();
  return {
    effectAllowed: '',
    setData: (type: string, value: string) => { store.set(type, value); },
    getData: (type: string) => store.get(type) ?? '',
    get types() { return [...store.keys()]; },
  };
}

function renderSidebar(props: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  mockApi.getFolders.mockResolvedValue(testFolders);
  mockApi.getFeeds.mockResolvedValue(testFeeds);

  return render(
    <Sidebar {...defaultProps} {...props} />,
    { wrapper: createWrapper() },
  );
}

describe('Sidebar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders "All Articles" button', async () => {
    renderSidebar();
    expect(await screen.findByText('All Articles')).toBeInTheDocument();
  });

  it('renders feed list after loading', async () => {
    renderSidebar();
    // Uncategorized feed
    expect(await screen.findByText('Tech Blog')).toBeInTheDocument();
    // Folder names
    expect(screen.getByText('Tech')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
  });

  it('shows total unread count badge', async () => {
    renderSidebar();
    await screen.findByText('All Articles');
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('shows 999+ for large unread counts', async () => {
    renderSidebar({
      unreadCounts: { feeds: {}, folders: {}, total: 1500 },
    });
    await screen.findByText('All Articles');
    expect(screen.getByText('999+')).toBeInTheDocument();
  });

  it('highlights selected "All Articles"', async () => {
    renderSidebar({ selection: { type: 'newsfeed' } });
    const btn = await screen.findByText('All Articles');
    expect(btn.closest('button')!.className).toContain('bg-accent-light');
  });

  it('calls onSelect when "All Articles" is clicked', async () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect });
    fireEvent.click(await screen.findByText('All Articles'));
    expect(onSelect).toHaveBeenCalledWith({ type: 'newsfeed' });
  });

  it('calls onSelect when feed is clicked', async () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect });
    fireEvent.click(await screen.findByText('Tech Blog'));
    expect(onSelect).toHaveBeenCalledWith({ type: 'feed', feedId: 1 });
  });

  it('highlights selected feed', async () => {
    renderSidebar({ selection: { type: 'feed', feedId: 1 } });
    const feedBtn = await screen.findByText('Tech Blog');
    // The parent div of the button should have the highlight class
    expect(feedBtn.closest('button')!.className).toContain('text-accent');
  });

  it('calls onSelect when folder is clicked', async () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect });
    fireEvent.click(await screen.findByText('Tech'));
    expect(onSelect).toHaveBeenCalledWith({
      type: 'folder',
      folderId: 100,
      folderName: 'Tech',
    });
  });

  it('expands and collapses folders', async () => {
    renderSidebar();
    await screen.findByText('Tech');

    // Feed inside the folder should not be visible initially
    expect(screen.queryByText('News Feed')).not.toBeInTheDocument();

    // Click the folder to select it (which also expands)
    fireEvent.click(screen.getByText('Tech'));

    // Now the feed inside should be visible
    expect(await screen.findByText('News Feed')).toBeInTheDocument();
  });

  it('shows folder unread count badge', async () => {
    renderSidebar();
    await screen.findByText('Tech');
    // Folder "Tech" has 5 unread
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows feed unread count', async () => {
    renderSidebar();
    await screen.findByText('Tech Blog');
    // Feed 1 has 3 unread
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows add feed panel when + button is clicked', async () => {
    renderSidebar();
    await screen.findByText('All Articles');
    fireEvent.click(screen.getByLabelText('Add feed'));
    const addFeedElements = await screen.findAllByText('Add Feed');
    expect(addFeedElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByPlaceholderText('Site or feed URL')).toBeInTheDocument();
    expect(screen.getByText('Create Folder')).toBeInTheDocument();
  });

  it('does not show add feed panel by default', async () => {
    renderSidebar();
    await screen.findByText('All Articles');
    expect(screen.queryByPlaceholderText('Site or feed URL')).not.toBeInTheDocument();
  });

  it('shows loading state while feeds/folders are loading', () => {
    mockApi.getFolders.mockReturnValue(new Promise(() => {})); // never resolves
    mockApi.getFeeds.mockReturnValue(new Promise(() => {}));
    render(
      <Sidebar {...defaultProps} />,
      { wrapper: createWrapper() },
    );
    expect(screen.getByText('Loading feeds...')).toBeInTheDocument();
  });

  it('shows error state and retry button on load failure', async () => {
    mockApi.getFolders.mockRejectedValue(new Error('fail'));
    mockApi.getFeeds.mockRejectedValue(new Error('fail'));
    render(
      <Sidebar {...defaultProps} />,
      { wrapper: createWrapper() },
    );
    expect(await screen.findByText('Failed to load feeds')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('does not show total unread badge when total is 0', async () => {
    renderSidebar({
      unreadCounts: { feeds: {}, folders: {}, total: 0 },
    });
    await screen.findByText('All Articles');
    // No badge should be present
    const allBtn = screen.getByText('All Articles').closest('button')!;
    const badge = allBtn.querySelector('.rounded-full');
    expect(badge).not.toBeInTheDocument();
  });

  it('shows folder select dropdown in add panel', async () => {
    renderSidebar({ openAddPanelToken: 1 });
    await screen.findAllByText('Add Feed');
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    // Should have "No folder" plus folder options
    const options = within(select).getAllByRole('option');
    expect(options[0]).toHaveTextContent('No folder');
  });

  it('submits add feed form and calls createFeed via discover', async () => {
    const onFeedAdding = vi.fn();
    mockApi.discoverFeed.mockResolvedValue([
      { feedUrl: 'https://example.com/feed.xml', title: 'Example Feed' },
    ]);
    mockApi.createFeed.mockResolvedValue({
      id: 99, title: 'Example Feed', url: 'https://example.com/feed.xml',
      siteUrl: 'https://example.com', folder: null, articleCount: 5,
    });

    renderSidebar({ openAddPanelToken: 1, onFeedAdding });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://example.com/feed.xml' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockApi.createFeed).toHaveBeenCalledWith('https://example.com/feed.xml', null);
    });
  });

  it('does not submit add feed form when URL is empty', async () => {
    renderSidebar({ openAddPanelToken: 1 });
    await screen.findAllByText('Add Feed');

    // Ensure URL input is empty (default state)
    const input = screen.getByPlaceholderText('Site or feed URL');
    expect(input).toHaveValue('');

    // Clear any prior call counts
    mockApi.discoverFeed.mockClear();
    mockApi.createFeed.mockClear();

    fireEvent.submit(input.closest('form')!);

    expect(mockApi.discoverFeed).not.toHaveBeenCalled();
    expect(mockApi.createFeed).not.toHaveBeenCalled();
  });

  it('toggles folder expand/collapse via chevron button', async () => {
    renderSidebar();
    await screen.findByText('Tech');

    // Feed inside folder not visible initially
    expect(screen.queryByText('News Feed')).not.toBeInTheDocument();

    // Click the chevron button (not the folder name) to expand
    const chevronBtn = screen.getByLabelText('Delete folder "Tech"').closest('div')!.querySelector('button')!;
    fireEvent.click(chevronBtn);

    // Now the feed inside should be visible
    expect(await screen.findByText('News Feed')).toBeInTheDocument();

    // Click chevron again to collapse
    fireEvent.click(chevronBtn);
    expect(screen.queryByText('News Feed')).not.toBeInTheDocument();
  });

  it('deletes a feed after confirming in modal', async () => {
    mockApi.deleteFeed.mockResolvedValue(undefined);

    renderSidebar();
    await screen.findByText('Tech Blog');

    const deleteBtn = screen.getByLabelText('Delete feed "Tech Blog"');
    fireEvent.click(deleteBtn);

    // Modal should appear
    expect(await screen.findByText('Unsubscribe from this feed?')).toBeInTheDocument();

    // Click confirm button
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));

    await waitFor(() => {
      expect(mockApi.deleteFeed).toHaveBeenCalledWith(1);
    });
  });

  it('does not delete a feed when cancelling in modal', async () => {
    mockApi.deleteFeed.mockClear();

    renderSidebar();
    await screen.findByText('Tech Blog');

    const deleteBtn = screen.getByLabelText('Delete feed "Tech Blog"');
    fireEvent.click(deleteBtn);

    // Modal should appear
    expect(await screen.findByText('Unsubscribe from this feed?')).toBeInTheDocument();

    // Click cancel
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Unsubscribe from this feed?')).not.toBeInTheDocument();
    expect(mockApi.deleteFeed).not.toHaveBeenCalled();
  });

  it('deletes a folder after confirming in modal', async () => {
    mockApi.deleteFolder.mockResolvedValue(undefined);

    renderSidebar();
    await screen.findByText('Tech');

    const deleteBtn = screen.getByLabelText('Delete folder "Tech"');
    fireEvent.click(deleteBtn);

    // Modal should appear
    expect(await screen.findByText('Delete this folder?')).toBeInTheDocument();

    // Click confirm button
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockApi.deleteFolder).toHaveBeenCalledWith(100);
    });
  });

  it('does not delete a folder when cancelling in modal', async () => {
    mockApi.deleteFolder.mockClear();

    renderSidebar();
    await screen.findByText('Tech');

    const deleteBtn = screen.getByLabelText('Delete folder "Tech"');
    fireEvent.click(deleteBtn);

    // Modal should appear
    expect(await screen.findByText('Delete this folder?')).toBeInTheDocument();

    // Click cancel
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Delete this folder?')).not.toBeInTheDocument();
    expect(mockApi.deleteFolder).not.toHaveBeenCalled();
  });

  it('shows multiple feed candidates when discover returns multiple results', async () => {
    mockApi.discoverFeed.mockResolvedValue([
      { feedUrl: 'https://example.com/rss.xml', title: 'RSS Feed', type: 'application/rss+xml' },
      { feedUrl: 'https://example.com/atom.xml', title: 'Atom Feed', type: 'application/atom+xml' },
    ]);

    renderSidebar({ openAddPanelToken: 1 });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://example.com' } });

    // Submit the form to trigger discovery
    fireEvent.submit(input.closest('form')!);

    // Wait for candidates to appear
    expect(await screen.findByText('RSS Feed')).toBeInTheDocument();
    expect(screen.getByText('Atom Feed')).toBeInTheDocument();

    // feedTypeLabel should render type badges
    expect(screen.getByText('RSS')).toBeInTheDocument();
    expect(screen.getByText('Atom')).toBeInTheDocument();
  });

  it('shows JSON and unknown feed type labels', async () => {
    mockApi.discoverFeed.mockResolvedValue([
      { feedUrl: 'https://example.com/json', title: 'JSON Feed', type: 'application/json' },
      { feedUrl: 'https://example.com/other', title: 'Other Feed', type: 'text/xml' },
    ]);

    renderSidebar({ openAddPanelToken: 1 });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('JSON Feed')).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
  });

  it('shows inline error with specific message when discover fails', async () => {
    mockApi.discoverFeed.mockRejectedValue(new Error('HTTP 422: no feed found at this URL'));

    renderSidebar({ openAddPanelToken: 1 });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('no feed found at this URL')).toBeInTheDocument();
  });

  it('shows inline error with specific message when addFeed fails', async () => {
    mockApi.discoverFeed.mockResolvedValue([
      { feedUrl: 'https://example.com/feed.xml', title: 'Example Feed' },
    ]);
    mockApi.createFeed.mockRejectedValue(new Error('HTTP 500: something went wrong upstream'));

    renderSidebar({ openAddPanelToken: 1 });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://example.com/feed.xml' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('something went wrong upstream')).toBeInTheDocument();
  });

  it('dismisses the inline add-feed error', async () => {
    mockApi.discoverFeed.mockRejectedValue(new Error('HTTP 422: bad url'));

    renderSidebar({ openAddPanelToken: 1 });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('bad url')).toBeInTheDocument();
    fireEvent.click(screen.getByText('dismiss'));
    expect(screen.queryByText('bad url')).not.toBeInTheDocument();
  });

  it('shows "Read articles" and "Add another" after a successful add, and Read articles selects the feed', async () => {
    const onSelect = vi.fn();
    mockApi.discoverFeed.mockResolvedValue([
      { feedUrl: 'https://example.com/feed.xml', title: 'Example Feed' },
    ]);
    mockApi.createFeed.mockResolvedValue({
      id: 99, title: 'Example Feed', url: 'https://example.com/feed.xml',
      siteUrl: 'https://example.com', folder: null, articleCount: 5,
    });

    renderSidebar({ openAddPanelToken: 1, onSelect });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://example.com/feed.xml' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('Read articles')).toBeInTheDocument();
    expect(screen.getByText('Add another')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Read articles'));
    expect(onSelect).toHaveBeenCalledWith({ type: 'feed', feedId: 99 });

    // Panel should close and success state clear
    expect(screen.queryByText('Read articles')).not.toBeInTheDocument();
  });

  it('"Add another" clears the success state and keeps the panel open', async () => {
    mockApi.discoverFeed.mockResolvedValue([
      { feedUrl: 'https://example.com/feed.xml', title: 'Example Feed' },
    ]);
    mockApi.createFeed.mockResolvedValue({
      id: 99, title: 'Example Feed', url: 'https://example.com/feed.xml',
      siteUrl: 'https://example.com', folder: null, articleCount: 5,
    });

    renderSidebar({ openAddPanelToken: 1 });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://example.com/feed.xml' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('Add another')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add another'));

    expect(screen.queryByText('Read articles')).not.toBeInTheDocument();
    // Panel is still open
    expect(screen.getByPlaceholderText('Site or feed URL')).toBeInTheDocument();
  });

  it('detects a duplicate feed URL (single candidate) without calling createFeed', async () => {
    mockApi.discoverFeed.mockResolvedValue([
      { feedUrl: 'https://tech.com/feed', title: 'Tech Blog Feed' },
    ]);
    mockApi.createFeed.mockClear();

    renderSidebar({ openAddPanelToken: 1 });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://tech.com/feed' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText(/already subscribed/)).toBeInTheDocument();
    expect(mockApi.createFeed).not.toHaveBeenCalled();
  });

  it('detects a duplicate feed URL (multiple candidates, selected) without calling createFeed', async () => {
    mockApi.discoverFeed.mockResolvedValue([
      { feedUrl: 'https://tech.com/feed', title: 'Tech Blog Feed', type: 'application/rss+xml' },
      { feedUrl: 'https://example.com/atom.xml', title: 'Atom Feed', type: 'application/atom+xml' },
    ]);
    mockApi.createFeed.mockClear();

    renderSidebar({ openAddPanelToken: 1 });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.submit(input.closest('form')!);

    // Wait for candidates, then select the first (duplicate) candidate and submit again.
    expect(await screen.findByText('Tech Blog Feed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tech Blog Feed'));
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText(/already subscribed/)).toBeInTheDocument();
    expect(mockApi.createFeed).not.toHaveBeenCalled();
  });

  it('selects feed inside expanded folder', async () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect });
    await screen.findByText('Tech');

    // Click folder to expand
    fireEvent.click(screen.getByText('Tech'));

    // Click feed inside folder
    const feedInFolder = await screen.findByText('News Feed');
    fireEvent.click(feedInFolder);

    expect(onSelect).toHaveBeenCalledWith({ type: 'feed', feedId: 2 });
  });

  it('FeedRow delete button calls onDelete with stopPropagation', async () => {
    mockApi.deleteFeed.mockClear();
    mockApi.deleteFeed.mockResolvedValue(undefined);

    const onSelect = vi.fn();
    renderSidebar({ onSelect });
    await screen.findByText('Tech Blog');

    // Click the delete button on the feed row
    const deleteBtn = screen.getByLabelText('Delete feed "Tech Blog"');
    fireEvent.click(deleteBtn);

    // Modal should appear; confirm deletion
    expect(await screen.findByText('Unsubscribe from this feed?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));

    // deleteFeed should be called but onSelect should NOT be called
    // because stopPropagation prevents the click from reaching the parent
    await waitFor(() => {
      expect(mockApi.deleteFeed).toHaveBeenCalledWith(1);
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  describe('drag & drop move', () => {
    it('marks feed rows as draggable', async () => {
      renderSidebar();
      const feedRow = (await screen.findByText('Tech Blog')).closest('div')!;
      expect(feedRow).toHaveAttribute('draggable', 'true');
    });

    it('moves an uncategorized feed into a folder via drop', async () => {
      mockApi.updateFeed.mockResolvedValue({
        id: 1, title: 'Tech Blog', url: 'https://tech.com/feed', siteUrl: 'https://tech.com', folder: 'Design', articleCount: 10,
      });
      renderSidebar();

      const feedRow = (await screen.findByText('Tech Blog')).closest('div')!;
      const folderRow = (await screen.findByText('Design')).closest('div')!;
      const dataTransfer = createDataTransferStub();

      fireEvent.dragStart(feedRow, { dataTransfer });
      fireEvent.dragOver(folderRow, { dataTransfer });
      fireEvent.drop(folderRow, { dataTransfer });

      await waitFor(() => {
        expect(mockApi.updateFeed).toHaveBeenCalledWith(1, { folder: 'Design' });
      });
    });

    it('applies drag-over highlight class to folder row and clears it on dragleave', async () => {
      renderSidebar();
      const folderNameEl = await screen.findByText('Design');
      const folderRow = folderNameEl.closest('div')!;
      const dataTransfer = createDataTransferStub();
      dataTransfer.setData(FEED_DND_TYPE, '1');

      fireEvent.dragOver(folderRow, { dataTransfer });
      expect(folderRow.className).toContain('ring-2');

      fireEvent.dragLeave(folderRow, { dataTransfer, relatedTarget: document.body });
      expect(folderRow.className).not.toContain('ring-2');
    });

    it('moves a feed from one folder to another via drop', async () => {
      mockApi.updateFeed.mockResolvedValue({
        id: 2, title: 'News Feed', url: 'https://news.com/feed', siteUrl: 'https://news.com', folder: 'Design', articleCount: 5,
      });
      renderSidebar();

      // Expand "Tech" folder to reveal "News Feed"
      fireEvent.click(await screen.findByText('Tech'));
      const feedRow = (await screen.findByText('News Feed')).closest('div')!;
      const targetFolderRow = (await screen.findByText('Design')).closest('div')!;
      const dataTransfer = createDataTransferStub();

      fireEvent.dragStart(feedRow, { dataTransfer });
      fireEvent.drop(targetFolderRow, { dataTransfer });

      await waitFor(() => {
        expect(mockApi.updateFeed).toHaveBeenCalledWith(2, { folder: 'Design' });
      });
    });

    it('moves a feed to "No folder" via the uncategorized drop zone', async () => {
      mockApi.updateFeed.mockResolvedValue({
        id: 2, title: 'News Feed', url: 'https://news.com/feed', siteUrl: 'https://news.com', folder: null, articleCount: 5,
      });
      renderSidebar();

      fireEvent.click(await screen.findByText('Tech'));
      const feedRow = (await screen.findByText('News Feed')).closest('div')!;
      const noFolderHeading = await screen.findByText('No folder');
      const dataTransfer = createDataTransferStub();

      fireEvent.dragStart(feedRow, { dataTransfer });
      fireEvent.drop(noFolderHeading, { dataTransfer });

      await waitFor(() => {
        expect(mockApi.updateFeed).toHaveBeenCalledWith(2, { folder: null });
      });
    });

    it('does not call updateFeed when dropping a feed onto its current folder (no-op)', async () => {
      mockApi.updateFeed.mockClear();
      renderSidebar();

      // "News Feed" (id 2) already belongs to folder "Tech"; expand it and drop back onto "Tech"
      const techFolderText = await screen.findByText('Tech');
      fireEvent.click(techFolderText);
      const feedRow = (await screen.findByText('News Feed')).closest('div')!;
      const techFolderRow = techFolderText.closest('div')!;
      const dataTransfer = createDataTransferStub();

      fireEvent.dragStart(feedRow, { dataTransfer });
      fireEvent.drop(techFolderRow, { dataTransfer });

      await new Promise((r) => setTimeout(r, 0));
      expect(mockApi.updateFeed).not.toHaveBeenCalled();
    });

    it('ignores drop when dataTransfer has no feed id data', async () => {
      mockApi.updateFeed.mockClear();
      renderSidebar();

      const folderRow = (await screen.findByText('Design')).closest('div')!;
      const dataTransfer = createDataTransferStub(); // no setData call

      fireEvent.drop(folderRow, { dataTransfer });

      await new Promise((r) => setTimeout(r, 0));
      expect(mockApi.updateFeed).not.toHaveBeenCalled();
    });

    it('ignores drop when the dragged feed id no longer exists in the feeds list', async () => {
      mockApi.updateFeed.mockClear();
      renderSidebar();

      const folderRow = (await screen.findByText('Design')).closest('div')!;
      const dataTransfer = createDataTransferStub();
      dataTransfer.setData(FEED_DND_TYPE, '9999');

      fireEvent.drop(folderRow, { dataTransfer });

      await new Promise((r) => setTimeout(r, 0));
      expect(mockApi.updateFeed).not.toHaveBeenCalled();
    });

    it('shows a success toast when a feed move succeeds', async () => {
      const addToast = vi.fn();
      const { useToast } = await import('../Toast');
      vi.mocked(useToast).mockReturnValue({ addToast });
      mockApi.updateFeed.mockResolvedValue({
        id: 1, title: 'Tech Blog', url: 'https://tech.com/feed', siteUrl: 'https://tech.com', folder: 'Design', articleCount: 10,
      });
      renderSidebar();

      const feedRow = (await screen.findByText('Tech Blog')).closest('div')!;
      const folderRow = (await screen.findByText('Design')).closest('div')!;
      const dataTransfer = createDataTransferStub();

      fireEvent.dragStart(feedRow, { dataTransfer });
      fireEvent.drop(folderRow, { dataTransfer });

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('Feed moved', 'success');
      });
    });

    it('shows an error toast when a feed move fails', async () => {
      const addToast = vi.fn();
      const { useToast } = await import('../Toast');
      vi.mocked(useToast).mockReturnValue({ addToast });
      mockApi.updateFeed.mockRejectedValue(new Error('Failed to move feed'));
      renderSidebar();

      const feedRow = (await screen.findByText('Tech Blog')).closest('div')!;
      const folderRow = (await screen.findByText('Design')).closest('div')!;
      const dataTransfer = createDataTransferStub();

      fireEvent.dragStart(feedRow, { dataTransfer });
      fireEvent.drop(folderRow, { dataTransfer });

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('Failed to move feed', 'error');
      });
    });
  });

  describe('move to folder select', () => {
    it('shows a select when the move button is clicked', async () => {
      renderSidebar();
      await screen.findByText('Tech Blog');

      const moveBtn = screen.getByLabelText('Move feed "Tech Blog" to folder');
      fireEvent.click(moveBtn);

      expect(screen.getByRole('combobox', { name: 'Move feed "Tech Blog" to folder' })).toBeInTheDocument();
    });

    it('calls updateFeed with the selected folder and closes the select', async () => {
      mockApi.updateFeed.mockResolvedValue({
        id: 1, title: 'Tech Blog', url: 'https://tech.com/feed', siteUrl: 'https://tech.com', folder: 'Tech', articleCount: 10,
      });
      renderSidebar();
      await screen.findByText('Tech Blog');

      fireEvent.click(screen.getByLabelText('Move feed "Tech Blog" to folder'));
      const select = screen.getByRole('combobox', { name: 'Move feed "Tech Blog" to folder' });
      fireEvent.change(select, { target: { value: 'Tech' } });

      await waitFor(() => {
        expect(mockApi.updateFeed).toHaveBeenCalledWith(1, { folder: 'Tech' });
      });
      expect(screen.queryByRole('combobox', { name: 'Move feed "Tech Blog" to folder' })).not.toBeInTheDocument();
    });

    it('does not call updateFeed when selecting the feed\'s current folder', async () => {
      mockApi.updateFeed.mockClear();
      renderSidebar();

      // "News Feed" (id 2) is already in folder "Tech"; expand to reveal it
      fireEvent.click(await screen.findByText('Tech'));
      const moveBtn = await screen.findByLabelText('Move feed "News Feed" to folder');
      fireEvent.click(moveBtn);

      const select = screen.getByRole('combobox', { name: 'Move feed "News Feed" to folder' });
      fireEvent.change(select, { target: { value: 'Tech' } });

      await new Promise((r) => setTimeout(r, 0));
      expect(mockApi.updateFeed).not.toHaveBeenCalled();
    });

    it('moves feed to "No folder" when that option is selected', async () => {
      mockApi.updateFeed.mockResolvedValue({
        id: 2, title: 'News Feed', url: 'https://news.com/feed', siteUrl: 'https://news.com', folder: null, articleCount: 5,
      });
      renderSidebar();

      fireEvent.click(await screen.findByText('Tech'));
      const moveBtn = await screen.findByLabelText('Move feed "News Feed" to folder');
      fireEvent.click(moveBtn);

      const select = screen.getByRole('combobox', { name: 'Move feed "News Feed" to folder' });
      fireEvent.change(select, { target: { value: '' } });

      await waitFor(() => {
        expect(mockApi.updateFeed).toHaveBeenCalledWith(2, { folder: null });
      });
    });

    it('stays closed if a blur event fires after change closed it', async () => {
      mockApi.updateFeed.mockResolvedValue({
        id: 1, title: 'Tech Blog', url: 'https://tech.com/feed', siteUrl: 'https://tech.com', folder: 'Tech', articleCount: 10,
      });
      renderSidebar();
      await screen.findByText('Tech Blog');

      fireEvent.click(screen.getByLabelText('Move feed "Tech Blog" to folder'));
      const select = screen.getByRole('combobox', { name: 'Move feed "Tech Blog" to folder' });
      fireEvent.change(select, { target: { value: 'Tech' } });
      // A browser may still dispatch blur on the select after the change
      // handler already closed it; that must not reopen the select.
      fireEvent.blur(select);

      await waitFor(() => {
        expect(mockApi.updateFeed).toHaveBeenCalledWith(1, { folder: 'Tech' });
      });
      expect(screen.queryByRole('combobox', { name: 'Move feed "Tech Blog" to folder' })).not.toBeInTheDocument();
    });
  });
});
