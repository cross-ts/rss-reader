import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ArticleRow } from '../ArticleRow';
import { renderWithProviders } from '../../test/render';
import { makeArticle } from '../../test/factories';

describe('ArticleRow', () => {
  it('renders title, feed and excerpt, links only to http(s)', () => {
    renderWithProviders(<ArticleRow article={makeArticle(1, { feedTitle: 'A &amp; B', content: '<p>hello world</p>' })} onSetRead={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Title 1' })).toHaveAttribute('href', 'https://example.com/1');
    expect(screen.getByText('A & B')).toBeInTheDocument();
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('drops javascript: urls', () => {
    renderWithProviders(<ArticleRow article={makeArticle(1, { url: 'javascript:alert(1)' })} onSetRead={vi.fn()} />);
    expect(screen.getByText('Title 1').closest('a')).not.toHaveAttribute('href');
  });

  it('marks as read when opening an unread article, and toggles via the button', async () => {
    const onSetRead = vi.fn();
    renderWithProviders(<ArticleRow article={makeArticle(7)} onSetRead={onSetRead} />);
    await userEvent.click(screen.getByRole('button', { name: '既読にする' }));
    expect(onSetRead).toHaveBeenCalledWith(7, true);
    screen.getByRole('link', { name: 'Title 7' }).addEventListener('click', (e) => e.preventDefault());
    await userEvent.click(screen.getByRole('link', { name: 'Title 7' }));
    expect(onSetRead).toHaveBeenCalledTimes(2);
  });

  it('offers 未読にする for read articles', () => {
    renderWithProviders(<ArticleRow article={makeArticle(1, { isRead: true })} onSetRead={vi.fn()} />);
    expect(screen.getByRole('button', { name: '未読にする' })).toBeInTheDocument();
  });
});
