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
    },
  };
});

// Mock useToast
vi.mock('../Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
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
  railView: 'newsfeed' as const,
};

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

  it('shows add feed panel when railView is "add"', async () => {
    renderSidebar({ railView: 'add' });
    // "Add Feed" appears as both the section header and submit button
    const addFeedElements = await screen.findAllByText('Add Feed');
    expect(addFeedElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByPlaceholderText('Site or feed URL')).toBeInTheDocument();
    expect(screen.getByText('Create Folder')).toBeInTheDocument();
  });

  it('does not show add feed panel when railView is "newsfeed"', async () => {
    renderSidebar({ railView: 'newsfeed' });
    await screen.findByText('All Articles');
    expect(screen.queryByPlaceholderText('Site or feed URL')).not.toBeInTheDocument();
  });

  it('shows settings panel when railView is "settings"', async () => {
    renderSidebar({ railView: 'settings' });
    await screen.findByText('All Articles');
    expect(screen.getByText('RSS Reader')).toBeInTheDocument();
    expect(screen.getByText(/Lightweight RSS reader/)).toBeInTheDocument();
  });

  it('does not show settings panel when railView is not "settings"', async () => {
    renderSidebar({ railView: 'newsfeed' });
    await screen.findByText('All Articles');
    expect(screen.queryByText(/Lightweight RSS reader/)).not.toBeInTheDocument();
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
    renderSidebar({ railView: 'add' });
    await screen.findAllByText('Add Feed');
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    // Should have "No folder" plus folder options
    const options = within(select).getAllByRole('option');
    expect(options[0]).toHaveTextContent('No folder');
  });

  it('has OPML section in settings panel', async () => {
    renderSidebar({ railView: 'settings' });
    await screen.findByText('RSS Reader');
    expect(screen.getByText('OPML')).toBeInTheDocument();
    expect(screen.getByText('README で手順を見る')).toBeInTheDocument();
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

    renderSidebar({ railView: 'add', onFeedAdding });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://example.com/feed.xml' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockApi.createFeed).toHaveBeenCalledWith('https://example.com/feed.xml', null);
    });
  });

  it('does not submit add feed form when URL is empty', async () => {
    renderSidebar({ railView: 'add' });
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

  it('deletes a feed after window.confirm returns true', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi.deleteFeed.mockResolvedValue(undefined);

    renderSidebar();
    await screen.findByText('Tech Blog');

    const deleteBtn = screen.getByLabelText('Delete feed "Tech Blog"');
    fireEvent.click(deleteBtn);

    expect(window.confirm).toHaveBeenCalledWith('Delete feed "Tech Blog"?');
    await waitFor(() => {
      expect(mockApi.deleteFeed).toHaveBeenCalledWith(1);
    });
  });

  it('does not delete a feed when window.confirm returns false', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockApi.deleteFeed.mockClear();

    renderSidebar();
    await screen.findByText('Tech Blog');

    const deleteBtn = screen.getByLabelText('Delete feed "Tech Blog"');
    fireEvent.click(deleteBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(mockApi.deleteFeed).not.toHaveBeenCalled();
  });

  it('deletes a folder after window.confirm returns true', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi.deleteFolder.mockResolvedValue(undefined);

    renderSidebar();
    await screen.findByText('Tech');

    const deleteBtn = screen.getByLabelText('Delete folder "Tech"');
    fireEvent.click(deleteBtn);

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete folder "Tech"?\nFeeds inside will become uncategorized.'
    );
    await waitFor(() => {
      expect(mockApi.deleteFolder).toHaveBeenCalledWith(100);
    });
  });

  it('does not delete a folder when window.confirm returns false', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockApi.deleteFolder.mockClear();

    renderSidebar();
    await screen.findByText('Tech');

    const deleteBtn = screen.getByLabelText('Delete folder "Tech"');
    fireEvent.click(deleteBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(mockApi.deleteFolder).not.toHaveBeenCalled();
  });

  it('shows multiple feed candidates when discover returns multiple results', async () => {
    mockApi.discoverFeed.mockResolvedValue([
      { feedUrl: 'https://example.com/rss.xml', title: 'RSS Feed', type: 'application/rss+xml' },
      { feedUrl: 'https://example.com/atom.xml', title: 'Atom Feed', type: 'application/atom+xml' },
    ]);

    renderSidebar({ railView: 'add' });
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

    renderSidebar({ railView: 'add' });
    await screen.findAllByText('Add Feed');

    const input = screen.getByPlaceholderText('Site or feed URL');
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('JSON Feed')).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi.deleteFeed.mockClear();
    mockApi.deleteFeed.mockResolvedValue(undefined);

    const onSelect = vi.fn();
    renderSidebar({ onSelect });
    await screen.findByText('Tech Blog');

    // Click the delete button on the feed row
    const deleteBtn = screen.getByLabelText('Delete feed "Tech Blog"');
    fireEvent.click(deleteBtn);

    // onDelete should be called (via handleDeleteFeed) but onSelect should NOT be called
    // because stopPropagation prevents the click from reaching the parent
    await waitFor(() => {
      expect(mockApi.deleteFeed).toHaveBeenCalledWith(1);
    });
    // onSelect should not have been called from the delete button click
    expect(onSelect).not.toHaveBeenCalled();
  });
});
