import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArticleView } from './ArticleView';
import type { Article } from '../api/client';

const article: Article = {
  id: 1,
  feedId: 1,
  feedTitle: 'Tech',
  title: 'Example title',
  url: 'https://example.com/article',
  author: null,
  content: '<p>Hello</p>',
  publishedAt: '2026-06-27T12:00:00.000Z',
  isRead: true,
  readAt: '2026-06-27T12:00:00.000Z',
  starred: false,
};

describe('ArticleView', () => {
  it('uses a neutral disabled cursor for unavailable navigation buttons', () => {
    render(
      <ArticleView
        article={article}
        onClose={vi.fn()}
        onMarkRead={vi.fn()}
        onPrev={null}
        onNext={null}
        onNextUnread={null}
      />,
    );

    const previousButton = screen.getByRole('button', { name: 'Previous article' });
    const nextButton = screen.getByRole('button', { name: 'Next article' });
    const nextUnreadButton = screen.getByRole('button', { name: 'Next unread article' });

    expect(previousButton).toHaveProperty('disabled', true);
    expect(nextButton).toHaveProperty('disabled', true);
    expect(nextUnreadButton).toHaveProperty('disabled', true);

    expect(previousButton.className).toContain('disabled:cursor-default');
    expect(nextButton.className).toContain('disabled:cursor-default');
    expect(nextUnreadButton.className).toContain('disabled:cursor-default');
  });
});
