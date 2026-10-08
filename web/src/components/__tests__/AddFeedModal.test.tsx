import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddFeedModal } from '../AddFeedModal';
import { api } from '../../api/client';
import { renderWithProviders } from '../../test/render';

describe('AddFeedModal', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('discovers, selects and adds a feed into the chosen folder', async () => {
    vi.spyOn(api, 'discoverFeed').mockResolvedValue([
      { feedUrl: 'https://ex.com/feed', title: 'Ex', type: 'rss' },
    ]);
    const create = vi.spyOn(api, 'createFeed').mockResolvedValue({} as never);
    const onClose = vi.fn();
    renderWithProviders(<AddFeedModal folders={[{ id: 1, name: 'Tech', feedCount: 0 }]} onClose={onClose} />);

    const add = screen.getByRole('button', { name: '追加' });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/example\.com/), 'ex.com{Enter}');
    expect(api.discoverFeed).toHaveBeenCalledWith('https://ex.com');
    await userEvent.click(await screen.findByText('Ex'));
    await userEvent.selectOptions(screen.getByLabelText('フォルダ'), 'Tech');
    expect(add).toBeEnabled();
    await userEvent.click(add);
    await waitFor(() => expect(create).toHaveBeenCalledWith('https://ex.com/feed', 'Tech'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows a message when nothing is found', async () => {
    vi.spyOn(api, 'discoverFeed').mockRejectedValue(new Error('HTTP 404'));
    renderWithProviders(<AddFeedModal folders={[]} onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/example\.com/), 'https://x.test{Enter}');
    expect(await screen.findByText('フィードが見つかりませんでした')).toBeInTheDocument();
  });
});
