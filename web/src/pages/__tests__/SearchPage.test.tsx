import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SearchPage } from '../SearchPage';
import { ToastProvider } from '../../components/Toast';
import { api } from '../../api/client';
import { makeArticle } from '../../test/factories';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <SearchPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('SearchPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getArticles').mockResolvedValue({ items: [makeArticle(1, { title: 'Hit' })], total: 1 });
    vi.spyOn(api, 'getFeeds').mockResolvedValue([
      { id: 1, title: 'Zenn', url: 'https://zenn.dev/feed', siteUrl: null, folder: null, articleCount: 3 },
      { id: 2, title: 'Other', url: 'https://o.example/feed', siteUrl: null, folder: null, articleCount: 1 },
    ]);
  });

  it('reads q from the URL and searches with it', async () => {
    location.hash = '#/search?q=react';
    renderPage();
    expect(screen.getByRole('searchbox')).toHaveValue('react');
    await waitFor(() => expect(api.getArticles).toHaveBeenCalledWith(expect.objectContaining({ q: 'react' })));
    expect(await screen.findByText('Hit')).toBeInTheDocument();
  });

  it('writes q back to the URL without remounting (focus kept)', async () => {
    location.hash = '#/search';
    renderPage();
    const input = screen.getByRole('searchbox');
    await userEvent.type(input, 'ab');
    expect(location.hash).toBe('#/search?q=ab');
    expect(input).toHaveFocus();
  });

  it('filters feeds on the feed tab', async () => {
    location.hash = '#/search';
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'フィード' }));
    expect(await screen.findByText('Zenn')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'zenn');
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
    expect(screen.getByText('3 件')).toBeInTheDocument();
  });
});
