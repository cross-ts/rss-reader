import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubscriptionsPage } from '../SubscriptionsPage';
import { api } from '../../api/client';
import { renderWithProviders } from '../../test/render';

const feed = { id: 5, title: 'Zenn', url: 'https://zenn.dev/feed', siteUrl: 'https://zenn.dev', folder: 'Tech', articleCount: 3 };

describe('SubscriptionsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getFolders').mockResolvedValue([{ id: 1, name: 'Tech', feedCount: 1 }]);
    vi.spyOn(api, 'getFeeds').mockResolvedValue([feed]);
    vi.spyOn(api, 'getUnreadCounts').mockResolvedValue({ total: 2, feeds: { '5': 2 }, folders: {} });
  });

  it('renders sections with counts', async () => {
    renderWithProviders(<SubscriptionsPage />);
    expect(await screen.findByText('Zenn')).toBeInTheDocument();
    expect(screen.getByText('1 フィード · 未読 2')).toBeInTheDocument();
    expect(screen.getByText(/^3 件/)).toBeInTheDocument();
  });

  it('renames a feed inline with Enter', async () => {
    const upd = vi.spyOn(api, 'updateFeed').mockResolvedValue({ ...feed, title: 'New' });
    renderWithProviders(<SubscriptionsPage />);
    await screen.findByText('Zenn');
    await userEvent.click(screen.getAllByRole('button', { name: 'タイトル編集' })[0]);
    const input = screen.getByLabelText('フィード名');
    await userEvent.clear(input);
    await userEvent.type(input, 'New{Enter}');
    await waitFor(() => expect(upd).toHaveBeenCalledWith(5, { title: 'New' }));
  });

  it('cancels inline rename with Escape', async () => {
    const upd = vi.spyOn(api, 'updateFeed');
    renderWithProviders(<SubscriptionsPage />);
    await screen.findByText('Zenn');
    await userEvent.click(screen.getAllByRole('button', { name: 'タイトル編集' })[0]);
    await userEvent.type(screen.getByLabelText('フィード名'), 'x{Escape}');
    expect(screen.queryByLabelText('フィード名')).not.toBeInTheDocument();
    expect(upd).not.toHaveBeenCalled();
  });

  it('moves a feed via the menu', async () => {
    const upd = vi.spyOn(api, 'updateFeed').mockResolvedValue(feed);
    renderWithProviders(<SubscriptionsPage />);
    await screen.findByText('Zenn');
    await userEvent.click(screen.getByRole('button', { name: 'フォルダ移動' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '未分類' }));
    await waitFor(() => expect(upd).toHaveBeenCalledWith(5, { folder: null }));
  });

  it('toasts on duplicate folder (409)', async () => {
    vi.spyOn(api, 'createFolder').mockRejectedValue(new Error('HTTP 409: dup'));
    renderWithProviders(<SubscriptionsPage />);
    await screen.findByText('Zenn');
    await userEvent.click(screen.getByRole('button', { name: '+ フォルダ' }));
    await userEvent.type(screen.getByRole('textbox'), 'Tech{Enter}');
    expect(await screen.findByText('同名のフォルダがあります')).toBeInTheDocument();
  });

  it('deletes a feed after confirmation', async () => {
    const del = vi.spyOn(api, 'deleteFeed').mockResolvedValue(undefined);
    renderWithProviders(<SubscriptionsPage />);
    await screen.findByText('Zenn');
    await userEvent.click(screen.getAllByRole('button', { name: '削除' })[1]);
    expect(screen.getByText(/取得済みの記事 3 件も削除/)).toBeInTheDocument();
    const btns = screen.getAllByRole('button', { name: '削除' });
    await userEvent.click(btns[btns.length - 1]);
    await waitFor(() => expect(del).toHaveBeenCalledWith(5));
  });
});
