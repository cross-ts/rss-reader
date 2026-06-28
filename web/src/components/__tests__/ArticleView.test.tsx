import { render, screen, fireEvent } from '@testing-library/react';
import { ArticleView } from '../ArticleView';
import type { Article } from '../../api/client';

vi.mock('dompurify', () => ({
  default: { sanitize: (html: string) => html },
}));

vi.mock('../../utils/time', () => ({
  relativeTime: (iso: string | null) => iso ?? 'unknown',
}));

vi.mock('../../utils/decodeEntities', () => ({
  decodeEntities: (text: string) => text,
}));

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 1,
    feedId: 10,
    feedTitle: 'Tech Blog',
    title: 'Test Article Title',
    url: 'https://example.com/article',
    author: 'John Doe',
    content: '<p>Article content here</p>',
    publishedAt: '2024-06-15T12:00:00Z',
    isRead: false,
    readAt: null,
    starred: false,
    ...overrides,
  };
}

const defaultProps = {
  article: null as Article | null,
  onClose: vi.fn(),
  onMarkRead: vi.fn(),
};

describe('ArticleView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows placeholder when no article is selected', () => {
    render(<ArticleView {...defaultProps} />);
    expect(screen.getByText('Select an article to read')).toBeInTheDocument();
  });

  it('renders article title, feedTitle, author, and date', () => {
    const article = makeArticle();
    render(<ArticleView {...defaultProps} article={article} />);

    expect(screen.getByText('Test Article Title')).toBeInTheDocument();
    expect(screen.getByText('Tech Blog')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    // relativeTime mock returns the ISO string
    expect(screen.getByText('2024-06-15T12:00:00Z')).toBeInTheDocument();
  });

  it('does not render author when null', () => {
    const article = makeArticle({ author: null });
    render(<ArticleView {...defaultProps} article={article} />);
    expect(screen.queryByText('by')).not.toBeInTheDocument();
  });

  it('renders sanitized content', () => {
    const article = makeArticle({ content: '<p>Sanitized content</p>' });
    const { container } = render(
      <ArticleView {...defaultProps} article={article} />,
    );
    const body = container.querySelector('.article-view-body');
    expect(body).toBeInTheDocument();
    expect(body!.innerHTML).toBe('<p>Sanitized content</p>');
  });

  it('shows navigation buttons', () => {
    const article = makeArticle();
    render(
      <ArticleView
        {...defaultProps}
        article={article}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onNextUnread={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Previous article')).toBeInTheDocument();
    expect(screen.getByLabelText('Next article')).toBeInTheDocument();
    expect(screen.getByLabelText('Next unread article')).toBeInTheDocument();
  });

  it('disables navigation buttons when callbacks are null', () => {
    const article = makeArticle();
    render(
      <ArticleView
        {...defaultProps}
        article={article}
        onPrev={null}
        onNext={null}
        onNextUnread={null}
      />,
    );
    expect(screen.getByLabelText('Previous article')).toBeDisabled();
    expect(screen.getByLabelText('Next article')).toBeDisabled();
    expect(screen.getByLabelText('Next unread article')).toBeDisabled();
  });

  it('calls navigation callbacks when clicked', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onNextUnread = vi.fn();
    const article = makeArticle();
    render(
      <ArticleView
        {...defaultProps}
        article={article}
        onPrev={onPrev}
        onNext={onNext}
        onNextUnread={onNextUnread}
      />,
    );
    fireEvent.click(screen.getByLabelText('Previous article'));
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Next article'));
    expect(onNext).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Next unread article'));
    expect(onNextUnread).toHaveBeenCalledTimes(1);
  });

  it('calls onMarkRead when unread article is opened', () => {
    const onMarkRead = vi.fn();
    const article = makeArticle({ id: 42, isRead: false });
    render(
      <ArticleView {...defaultProps} article={article} onMarkRead={onMarkRead} />,
    );
    expect(onMarkRead).toHaveBeenCalledWith(42);
  });

  it('does not call onMarkRead for already-read articles', () => {
    const onMarkRead = vi.fn();
    const article = makeArticle({ id: 42, isRead: true });
    render(
      <ArticleView {...defaultProps} article={article} onMarkRead={onMarkRead} />,
    );
    expect(onMarkRead).not.toHaveBeenCalled();
  });

  it('shows "Open original" link for http URLs', () => {
    const article = makeArticle({ url: 'https://example.com/post' });
    render(<ArticleView {...defaultProps} article={article} />);
    const link = screen.getByText('Open original');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com/post');
    expect(link.closest('a')).toHaveAttribute('target', '_blank');
  });

  it('does not show "Open original" for non-http URLs', () => {
    const article = makeArticle({ url: 'ftp://example.com/file' });
    render(<ArticleView {...defaultProps} article={article} />);
    expect(screen.queryByText('Open original')).not.toBeInTheDocument();
  });

  it('shows toggle read button with correct label', () => {
    const onToggleRead = vi.fn();
    const article = makeArticle();
    render(
      <ArticleView
        {...defaultProps}
        article={article}
        isRead={false}
        onToggleRead={onToggleRead}
      />,
    );
    const btn = screen.getByLabelText('Mark as read');
    expect(btn).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();

    fireEvent.click(btn);
    expect(onToggleRead).toHaveBeenCalledTimes(1);
  });

  it('shows unread label when article is read', () => {
    const article = makeArticle();
    render(
      <ArticleView
        {...defaultProps}
        article={article}
        isRead={true}
        onToggleRead={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Mark as unread')).toBeInTheDocument();
    expect(screen.getByText('Unread')).toBeInTheDocument();
  });

  it('shows star/unstar toggle button', () => {
    const onToggleStarred = vi.fn();
    const article = makeArticle();

    // Unstarred state
    const { rerender } = render(
      <ArticleView
        {...defaultProps}
        article={article}
        starred={false}
        onToggleStarred={onToggleStarred}
      />,
    );
    expect(screen.getByLabelText('Star')).toBeInTheDocument();
    expect(screen.getByText('Star')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Star'));
    expect(onToggleStarred).toHaveBeenCalledTimes(1);

    // Starred state
    rerender(
      <ArticleView
        {...defaultProps}
        article={article}
        starred={true}
        onToggleStarred={onToggleStarred}
      />,
    );
    expect(screen.getByLabelText('Unstar')).toBeInTheDocument();
    expect(screen.getByText('Starred')).toBeInTheDocument();
  });

  it('does not show toggle read button when onToggleRead is not provided', () => {
    const article = makeArticle();
    render(<ArticleView {...defaultProps} article={article} />);
    expect(screen.queryByLabelText('Mark as read')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mark as unread')).not.toBeInTheDocument();
  });

  it('does not show star button when onToggleStarred is not provided', () => {
    const article = makeArticle();
    render(<ArticleView {...defaultProps} article={article} />);
    expect(screen.queryByLabelText('Star')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Unstar')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    const article = makeArticle();
    render(<ArticleView {...defaultProps} article={article} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close article'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
