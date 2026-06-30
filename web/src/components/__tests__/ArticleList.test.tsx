import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArticleList } from '../ArticleList';
import type { Article } from '../../api/client';

vi.mock('../../utils/thumbnail', () => ({
  extractThumbnail: () => null,
}));

vi.mock('../../utils/time', () => ({
  relativeTime: (iso: string | null) => iso ?? '',
}));

vi.mock('../../utils/decodeEntities', () => ({
  decodeEntities: (text: string) => text,
}));

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 1,
    feedId: 10,
    feedTitle: 'Test Feed',
    title: 'Test Article',
    url: 'https://example.com/article',
    author: null,
    content: '<p>hello</p>',
    publishedAt: '2024-01-01T00:00:00Z',
    isRead: false,
    readAt: null,
    starred: false,
    ...overrides,
  };
}

const defaultProps = {
  articles: [] as Article[],
  isLoading: false,
  isError: false,
  hasFeeds: true,
  selectedArticleId: null,
  onSelectArticle: vi.fn(),
};

describe('ArticleList', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders skeleton rows in loading state', () => {
    const { container } = render(
      <ArticleList {...defaultProps} isLoading={true} />,
    );
    const skeletons = container.querySelectorAll('.skeleton');
    // Each SkeletonRow has 4 skeleton divs, 10 rows = 40
    expect(skeletons.length).toBe(40);
  });

  it('shows error message and retry button in error state', () => {
    const onRetry = vi.fn();
    render(
      <ArticleList {...defaultProps} isError={true} onRetry={onRetry} />,
    );
    expect(screen.getByText('Failed to load articles')).toBeInTheDocument();
    const retryBtn = screen.getByText('Retry');
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows error without retry button when onRetry is not provided', () => {
    render(<ArticleList {...defaultProps} isError={true} />);
    expect(screen.getByText('Failed to load articles')).toBeInTheDocument();
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
  });

  it('shows onboarding when no feeds', () => {
    const onOpenAddFeed = vi.fn();
    const onOpenOpmlGuide = vi.fn();
    render(
      <ArticleList
        {...defaultProps}
        hasFeeds={false}
        onOpenAddFeed={onOpenAddFeed}
        onOpenOpmlGuide={onOpenOpmlGuide}
      />,
    );
    expect(screen.getByText('まだフィードが登録されていません')).toBeInTheDocument();

    fireEvent.click(screen.getByText('最初のフィードを追加する'));
    expect(onOpenAddFeed).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('OPML の使い方を見る'));
    expect(onOpenOpmlGuide).toHaveBeenCalledTimes(1);
  });

  it('shows "記事がありません" when has feeds but no articles', () => {
    render(<ArticleList {...defaultProps} hasFeeds={true} />);
    expect(screen.getByText('記事がありません')).toBeInTheDocument();
  });

  it('shows selectionLabel in empty state when provided', () => {
    render(
      <ArticleList {...defaultProps} hasFeeds={true} selectionLabel="Tech News" />,
    );
    expect(screen.getByText('Tech News に記事がありません')).toBeInTheDocument();
  });

  it('shows refresh button in empty state when onRefresh provided', () => {
    const onRefresh = vi.fn();
    render(
      <ArticleList {...defaultProps} hasFeeds={true} onRefresh={onRefresh} />,
    );
    const refreshBtn = screen.getByText('更新');
    fireEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows "未読記事はありません" when unreadOnly with totalCount > 0', () => {
    const onToggleUnreadOnly = vi.fn();
    render(
      <ArticleList
        {...defaultProps}
        unreadOnly={true}
        totalCount={5}
        onToggleUnreadOnly={onToggleUnreadOnly}
      />,
    );
    expect(screen.getByText('未読記事はありません')).toBeInTheDocument();

    fireEvent.click(screen.getByText('すべての記事を表示'));
    expect(onToggleUnreadOnly).toHaveBeenCalledTimes(1);
  });

  it('shows search empty state with query', () => {
    const onClearSearch = vi.fn();
    render(
      <ArticleList
        {...defaultProps}
        searchQuery="React"
        onClearSearch={onClearSearch}
        selectionLabel="All Articles"
      />,
    );
    expect(screen.getByText(/に一致する記事はありません/)).toBeInTheDocument();
    expect(screen.getByText('All Articles を検索')).toBeInTheDocument();

    fireEvent.click(screen.getByText('検索をクリア'));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it('shows adding feed spinner', () => {
    render(
      <ArticleList
        {...defaultProps}
        addingFeedName="My Blog"
      />,
    );
    expect(screen.getByText('My Blog から記事を取得しています…')).toBeInTheDocument();
  });

  it('renders article rows with title, feedTitle, and time', () => {
    const articles = [
      makeArticle({ id: 1, title: 'First Article', feedTitle: 'Feed A', publishedAt: '2024-01-01T00:00:00Z' }),
      makeArticle({ id: 2, title: 'Second Article', feedTitle: 'Feed B', publishedAt: '2024-02-01T00:00:00Z' }),
    ];
    render(
      <ArticleList {...defaultProps} articles={articles} />,
    );
    expect(screen.getByText('First Article')).toBeInTheDocument();
    expect(screen.getByText('Second Article')).toBeInTheDocument();
    expect(screen.getByText('Feed A')).toBeInTheDocument();
    expect(screen.getByText('Feed B')).toBeInTheDocument();
  });

  it('calls onSelectArticle when row is clicked', () => {
    const onSelect = vi.fn();
    const article = makeArticle({ id: 1 });
    render(
      <ArticleList {...defaultProps} articles={[article]} onSelectArticle={onSelect} />,
    );
    fireEvent.click(screen.getByText('Test Article'));
    expect(onSelect).toHaveBeenCalledWith(article);
  });

  it('applies highlighted style to selected article', () => {
    const article = makeArticle({ id: 1 });
    const { container } = render(
      <ArticleList {...defaultProps} articles={[article]} selectedArticleId={1} />,
    );
    const button = container.querySelector('[data-article-id="1"]')!;
    expect(button.className).toContain('bg-accent-light');
  });

  it('applies muted text to read article titles', () => {
    const article = makeArticle({ id: 1, isRead: true });
    const { container } = render(
      <ArticleList {...defaultProps} articles={[article]} />,
    );
    const title = container.querySelector('h3')!;
    expect(title.className).toContain('text-text-muted');
    expect(title.className).not.toContain('font-semibold');
  });

  it('shows unread indicator dot for unread articles', () => {
    const article = makeArticle({ id: 1, isRead: false });
    const { container } = render(
      <ArticleList {...defaultProps} articles={[article]} />,
    );
    const dot = container.querySelector('.bg-accent.rounded-full');
    expect(dot).toBeInTheDocument();
  });

  it('shows star icon for starred articles', () => {
    const article = makeArticle({ id: 1, starred: true });
    const { container } = render(
      <ArticleList {...defaultProps} articles={[article]} />,
    );
    const star = container.querySelector('.text-amber-400');
    expect(star).toBeInTheDocument();
  });

  it('does not show star icon for non-starred articles', () => {
    const article = makeArticle({ id: 1, starred: false });
    const { container } = render(
      <ArticleList {...defaultProps} articles={[article]} />,
    );
    const star = container.querySelector('.text-amber-400');
    expect(star).not.toBeInTheDocument();
  });

  it('shows "もっと読む" button when hasMore is true', () => {
    const onLoadMore = vi.fn();
    const article = makeArticle({ id: 1 });
    render(
      <ArticleList {...defaultProps} articles={[article]} hasMore={true} onLoadMore={onLoadMore} />,
    );
    const btn = screen.getByText('もっと読む');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not show "もっと読む" button when hasMore is false', () => {
    const article = makeArticle({ id: 1 });
    render(
      <ArticleList {...defaultProps} articles={[article]} hasMore={false} />,
    );
    expect(screen.queryByText('もっと読む')).not.toBeInTheDocument();
  });

  it('shows spinner when isFetchingMore is true', () => {
    const article = makeArticle({ id: 1 });
    render(
      <ArticleList {...defaultProps} articles={[article]} hasMore={true} isFetchingMore={true} />,
    );
    expect(screen.getByText('読み込み中…')).toBeInTheDocument();
    expect(screen.queryByText('もっと読む')).not.toBeInTheDocument();
  });
});
