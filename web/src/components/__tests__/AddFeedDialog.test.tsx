import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddFeedDialog } from '../AddFeedDialog';
import { api } from '../../api/client';
import { renderWithProviders } from '../../test/render';

const urlInput = () => screen.getByRole('textbox', { name: 'URL' });
const addButton = () => screen.getByRole('button', { name: '追加' });
// Astryx の Button は disabled 属性か aria-disabled のどちらかで無効を表す
const isDisabled = (el: HTMLElement) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

describe('AddFeedDialog', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('discovers, selects and adds a feed into the chosen folder', async () => {
    vi.spyOn(api, 'discoverFeed').mockResolvedValue([
      { feedUrl: 'https://ex.com/feed', title: 'Ex', type: 'rss' },
      { feedUrl: 'https://ex.com/atom', title: 'Ex Atom', type: 'atom' },
    ]);
    const create = vi.spyOn(api, 'createFeed').mockResolvedValue({} as never);
    const onClose = vi.fn();
    renderWithProviders(<AddFeedDialog folders={[{ id: 1, name: 'Tech', feedCount: 0 }]} onClose={onClose} />);

    expect(isDisabled(addButton())).toBe(true);
    await userEvent.type(urlInput(), 'ex.com{Enter}');
    expect(api.discoverFeed).toHaveBeenCalledWith('https://ex.com');
    await userEvent.click(await screen.findByText('Ex'));
    await userEvent.click(screen.getByRole('combobox', { name: 'フォルダ' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Tech' }));
    expect(isDisabled(addButton())).toBe(false);
    await userEvent.click(addButton());
    await waitFor(() => expect(create).toHaveBeenCalledWith('https://ex.com/feed', 'Tech'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('auto-selects the only candidate and adds it uncategorised', async () => {
    vi.spyOn(api, 'discoverFeed').mockResolvedValue([{ feedUrl: 'https://solo.com/feed', title: 'Solo' }]);
    const create = vi.spyOn(api, 'createFeed').mockResolvedValue({} as never);
    renderWithProviders(<AddFeedDialog folders={[]} onClose={() => {}} />);
    await userEvent.type(urlInput(), 'solo.com{Enter}');
    await screen.findByText('Solo');
    expect(isDisabled(addButton())).toBe(false);
    await userEvent.click(addButton());
    await waitFor(() => expect(create).toHaveBeenCalledWith('https://solo.com/feed', null));
  });

  it('shows a message when nothing is found', async () => {
    vi.spyOn(api, 'discoverFeed').mockRejectedValue(new Error('HTTP 404'));
    renderWithProviders(<AddFeedDialog folders={[]} onClose={() => {}} />);
    await userEvent.type(urlInput(), 'https://x.test{Enter}');
    expect(await screen.findByText('フィードが見つかりませんでした')).toBeInTheDocument();
  });

  it('clears candidates and selection when the URL is edited', async () => {
    vi.spyOn(api, 'discoverFeed').mockResolvedValue([{ feedUrl: 'https://ex.com/feed', title: 'Ex' }]);
    renderWithProviders(<AddFeedDialog folders={[]} onClose={() => {}} />);
    await userEvent.type(urlInput(), 'ex.com{Enter}');
    await screen.findByText('Ex');
    expect(isDisabled(addButton())).toBe(false);
    await userEvent.type(urlInput(), 'x');
    expect(screen.queryByText('Ex')).not.toBeInTheDocument();
    expect(isDisabled(addButton())).toBe(true);
  });

  it('discards a stale discover response after the URL changed', async () => {
    let resolve!: (v: { feedUrl: string; title: string }[]) => void;
    vi.spyOn(api, 'discoverFeed').mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithProviders(<AddFeedDialog folders={[]} onClose={() => {}} />);
    await userEvent.type(urlInput(), 'old.com{Enter}');
    await userEvent.type(urlInput(), 'x');
    resolve([{ feedUrl: 'https://old.com/feed', title: 'Old' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
  });
});
