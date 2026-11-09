import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { SubscriptionsPage } from '../SubscriptionsPage';
import { renderWithProviders } from '../../test/render';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getFolders').mockResolvedValue([{ id: 1, name: 'Tech', feedCount: 1 }]);
  vi.spyOn(api, 'getFeeds').mockResolvedValue([
    { id: 10, title: 'Alpha', url: 'https://a.example/feed', siteUrl: 'https://a.example', folder: 'Tech', articleCount: 3 },
    { id: 11, title: 'Beta', url: 'https://b.example/feed', siteUrl: null, folder: null, articleCount: 1 },
  ]);
  vi.spyOn(api, 'getUnreadCounts').mockResolvedValue({ total: 2, feeds: { '10': 2 }, folders: {} });
});

describe('SubscriptionsPage', () => {
  it('groups feeds by folder with unread counts', async () => {
    renderWithProviders(<SubscriptionsPage />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tech/, expanded: true })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '未分類' })).toBeInTheDocument();
    expect(screen.getByText('未読 2')).toBeInTheDocument();
  });

  it('filters feeds by name', async () => {
    renderWithProviders(<SubscriptionsPage />);
    await screen.findByText('Alpha');
    await userEvent.type(screen.getByRole('searchbox', { name: '絞り込み' }), 'beta');
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('deletes a feed after confirmation', async () => {
    const del = vi.spyOn(api, 'deleteFeed').mockResolvedValue(undefined);
    renderWithProviders(<SubscriptionsPage />);
    await screen.findByText('Alpha');
    await userEvent.click(screen.getAllByRole('button', { name: '削除' })[0]);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '削除' }));
    expect(del).toHaveBeenCalledWith(10);
  });
});
