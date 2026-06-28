import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Topbar } from '../Topbar';

const defaultProps = {
  viewTitle: 'All Articles',
  searchText: '',
  onSearchChange: vi.fn(),
  onSearchClear: vi.fn(),
  hasActiveSearch: false,
  unreadOnly: false,
  onToggleUnreadOnly: vi.fn(),
  onMarkAllRead: vi.fn(),
  onRefresh: vi.fn(),
  isRefreshing: false,
};

function renderTopbar(overrides: Partial<Parameters<typeof Topbar>[0]> = {}) {
  const props = { ...defaultProps, ...overrides };
  // Reset mocks that come from defaultProps
  for (const key of Object.keys(defaultProps) as (keyof typeof defaultProps)[]) {
    const val = props[key];
    if (typeof val === 'function' && 'mockClear' in val) {
      (val as ReturnType<typeof vi.fn>).mockClear();
    }
  }
  return render(<Topbar {...props} />);
}

describe('Topbar', () => {
  describe('view title', () => {
    it('renders the view title', () => {
      renderTopbar({ viewTitle: 'My Feed' });
      expect(screen.getByText('My Feed')).toBeInTheDocument();
    });
  });

  describe('search', () => {
    it('renders search input with placeholder', () => {
      renderTopbar();
      expect(screen.getByPlaceholderText('Search articles...')).toBeInTheDocument();
    });

    it('displays search text value', () => {
      renderTopbar({ searchText: 'react' });
      expect(screen.getByDisplayValue('react')).toBeInTheDocument();
    });

    it('calls onSearchChange when typing', async () => {
      const onSearchChange = vi.fn();
      renderTopbar({ onSearchChange });
      const input = screen.getByRole('textbox', { name: 'Search articles' });
      fireEvent.change(input, { target: { value: 'test' } });
      expect(onSearchChange).toHaveBeenCalledWith('test');
    });

    it('calls onSearchClear on Escape key', async () => {
      const onSearchClear = vi.fn();
      renderTopbar({ searchText: 'query', onSearchClear });
      const input = screen.getByRole('textbox', { name: 'Search articles' });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onSearchClear).toHaveBeenCalledTimes(1);
    });

    it('blurs input on Escape key', () => {
      renderTopbar({ searchText: 'query' });
      const input = screen.getByRole('textbox', { name: 'Search articles' });
      input.focus();
      expect(input).toHaveFocus();
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(input).not.toHaveFocus();
    });

    it('does not call onSearchClear on other keys', () => {
      const onSearchClear = vi.fn();
      renderTopbar({ searchText: 'query', onSearchClear });
      const input = screen.getByRole('textbox', { name: 'Search articles' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSearchClear).not.toHaveBeenCalled();
    });

    it('shows clear button when searchText is present', () => {
      renderTopbar({ searchText: 'something' });
      expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    });

    it('shows clear button when hasActiveSearch is true', () => {
      renderTopbar({ hasActiveSearch: true });
      expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    });

    it('does not show clear button when no search text and no active search', () => {
      renderTopbar({ searchText: '', hasActiveSearch: false });
      expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    });

    it('calls onSearchClear when clear button is clicked', () => {
      const onSearchClear = vi.fn();
      renderTopbar({ searchText: 'test', onSearchClear });
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
      expect(onSearchClear).toHaveBeenCalledTimes(1);
    });
  });

  describe('search hit count', () => {
    it('shows hit count when hasActiveSearch and searchHitCount is provided', () => {
      renderTopbar({ hasActiveSearch: true, searchHitCount: 42 });
      expect(screen.getByText('42 hits')).toBeInTheDocument();
    });

    it('uses singular "hit" for count of 1', () => {
      renderTopbar({ hasActiveSearch: true, searchHitCount: 1 });
      expect(screen.getByText('1 hit')).toBeInTheDocument();
    });

    it('shows 0 hits', () => {
      renderTopbar({ hasActiveSearch: true, searchHitCount: 0 });
      expect(screen.getByText('0 hits')).toBeInTheDocument();
    });

    it('does not show hit count when hasActiveSearch is false', () => {
      renderTopbar({ hasActiveSearch: false, searchHitCount: 10 });
      expect(screen.queryByText('10 hits')).not.toBeInTheDocument();
    });

    it('shows search scope when provided', () => {
      renderTopbar({ hasActiveSearch: true, searchScope: 'Tech News' });
      expect(screen.getByText('in Tech News')).toBeInTheDocument();
    });

    it('does not show search scope when hasActiveSearch is false', () => {
      renderTopbar({ hasActiveSearch: false, searchScope: 'Tech News' });
      expect(screen.queryByText('in Tech News')).not.toBeInTheDocument();
    });
  });

  describe('unread toggle', () => {
    it('calls onToggleUnreadOnly when clicked', () => {
      const onToggleUnreadOnly = vi.fn();
      renderTopbar({ onToggleUnreadOnly });
      fireEvent.click(screen.getByText('Unread'));
      expect(onToggleUnreadOnly).toHaveBeenCalledTimes(1);
    });

    it('shows "Show all articles" label when unreadOnly is true', () => {
      renderTopbar({ unreadOnly: true });
      expect(screen.getByRole('button', { name: 'Show all articles' })).toBeInTheDocument();
    });

    it('shows "Show unread only" label when unreadOnly is false', () => {
      renderTopbar({ unreadOnly: false });
      expect(screen.getByRole('button', { name: 'Show unread only' })).toBeInTheDocument();
    });

    it('has aria-pressed=true when unreadOnly is true', () => {
      renderTopbar({ unreadOnly: true });
      expect(screen.getByRole('button', { name: 'Show all articles' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('has aria-pressed=false when unreadOnly is false', () => {
      renderTopbar({ unreadOnly: false });
      expect(screen.getByRole('button', { name: 'Show unread only' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('applies active styling when unreadOnly is true', () => {
      renderTopbar({ unreadOnly: true });
      const btn = screen.getByRole('button', { name: 'Show all articles' });
      expect(btn.className).toContain('bg-accent');
    });
  });

  describe('mark all read', () => {
    it('calls onMarkAllRead when clicked', () => {
      const onMarkAllRead = vi.fn();
      renderTopbar({ onMarkAllRead });
      fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
      expect(onMarkAllRead).toHaveBeenCalledTimes(1);
    });
  });

  describe('refresh', () => {
    it('calls onRefresh when clicked', () => {
      const onRefresh = vi.fn();
      renderTopbar({ onRefresh });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh feeds' }));
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('shows "Refresh" text when not refreshing', () => {
      renderTopbar({ isRefreshing: false });
      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });

    it('shows "Refreshing..." text when refreshing', () => {
      renderTopbar({ isRefreshing: true });
      expect(screen.getByText('Refreshing...')).toBeInTheDocument();
    });

    it('disables refresh button when refreshing', () => {
      renderTopbar({ isRefreshing: true });
      expect(screen.getByRole('button', { name: 'Refresh feeds' })).toBeDisabled();
    });

    it('is not disabled when not refreshing', () => {
      renderTopbar({ isRefreshing: false });
      expect(screen.getByRole('button', { name: 'Refresh feeds' })).toBeEnabled();
    });

    it('applies spin animation when refreshing', () => {
      renderTopbar({ isRefreshing: true });
      const btn = screen.getByRole('button', { name: 'Refresh feeds' });
      const svg = btn.querySelector('svg');
      expect(svg?.className.baseVal || svg?.getAttribute('class')).toContain('animate-spin');
    });
  });

  describe('last updated', () => {
    it('shows last updated text when provided', () => {
      renderTopbar({ lastUpdated: '5 min ago' });
      expect(screen.getByText('Updated 5 min ago')).toBeInTheDocument();
    });

    it('does not show last updated when not provided', () => {
      renderTopbar({ lastUpdated: null });
      expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
    });
  });

  describe('sidebar toggle', () => {
    it('does not show sidebar toggle by default', () => {
      renderTopbar();
      expect(screen.queryByRole('button', { name: /sidebar/i })).not.toBeInTheDocument();
    });

    it('shows sidebar toggle when canToggleSidebar is true', () => {
      const onToggleSidebar = vi.fn();
      renderTopbar({ canToggleSidebar: true, onToggleSidebar });
      expect(screen.getByRole('button', { name: /sidebar/i })).toBeInTheDocument();
    });

    it('calls onToggleSidebar when sidebar button is clicked', () => {
      const onToggleSidebar = vi.fn();
      renderTopbar({ canToggleSidebar: true, onToggleSidebar });
      fireEvent.click(screen.getByRole('button', { name: /sidebar/i }));
      expect(onToggleSidebar).toHaveBeenCalledTimes(1);
    });

    it('shows "Hide sidebar" when sidebar is open', () => {
      renderTopbar({ canToggleSidebar: true, isSidebarOpen: true, onToggleSidebar: vi.fn() });
      expect(screen.getByRole('button', { name: 'Hide sidebar' })).toBeInTheDocument();
    });

    it('shows "Show sidebar" when sidebar is closed', () => {
      renderTopbar({ canToggleSidebar: true, isSidebarOpen: false, onToggleSidebar: vi.fn() });
      expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();
    });

    it('has aria-pressed matching isSidebarOpen', () => {
      renderTopbar({ canToggleSidebar: true, isSidebarOpen: true, onToggleSidebar: vi.fn() });
      expect(screen.getByRole('button', { name: 'Hide sidebar' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('does not show sidebar toggle when canToggleSidebar is true but onToggleSidebar is not provided', () => {
      renderTopbar({ canToggleSidebar: true });
      expect(screen.queryByRole('button', { name: /sidebar/i })).not.toBeInTheDocument();
    });
  });
});
