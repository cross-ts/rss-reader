import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArticleTimeline } from '../ArticleTimeline';
import { api } from '../../api/client';
import { makeArticle } from '../../test/factories';
import { renderWithProviders } from '../../test/render';

let trigger: () => void;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
        trigger = () => cb([{ isIntersecting: true }]);
      }
      observe() {}
      disconnect() {}
    },
  );
});

describe('ArticleTimeline', () => {
  it('stops auto-loading after a next-page failure and retries manually', async () => {
    const spy = vi
      .spyOn(api, 'getArticles')
      .mockResolvedValueOnce({ items: [makeArticle(1)], total: 2 })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: [makeArticle(2)], total: 2 });
    renderWithProviders(<ArticleTimeline q="" emptyText="none" />);
    await screen.findByText('Title 1');
    trigger();
    const retry = await screen.findByRole('button', { name: '再試行' });
    expect(spy).toHaveBeenCalledTimes(2);
    await userEvent.click(retry);
    expect(await screen.findByText('Title 2')).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
  });
});
