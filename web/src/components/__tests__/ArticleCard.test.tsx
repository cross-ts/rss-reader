import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArticleCard } from '../ArticleCard';
import { ToastProvider } from '../Toast';
import { makeArticle } from '../../test/factories';

function setup(over = {}) {
  const onSetRead = vi.fn();
  render(
    <ToastProvider>
      <ArticleCard article={makeArticle(7, over)} onSetRead={onSetRead} />
    </ToastProvider>,
  );
  return onSetRead;
}

describe('ArticleCard', () => {
  it('marks unread article as read when the link is clicked', async () => {
    const onSetRead = setup({ title: 'Hello' });
    const link = screen.getByRole('link', { name: 'Hello' });
    expect(link).toHaveAttribute('target', '_blank');
    link.addEventListener('click', (e) => e.preventDefault());
    await userEvent.click(link);
    expect(onSetRead).toHaveBeenCalledWith(7, true);
  });

  it('does not call setRead on link click when already read', async () => {
    const onSetRead = setup({ title: 'Hello', isRead: true });
    const link = screen.getByRole('link', { name: 'Hello' });
    link.addEventListener('click', (e) => e.preventDefault());
    await userEvent.click(link);
    expect(onSetRead).not.toHaveBeenCalled();
  });

  it('toggles read state', async () => {
    const onSetRead = setup();
    await userEvent.click(screen.getByRole('button', { name: '既読にする' }));
    expect(onSetRead).toHaveBeenCalledWith(7, true);
  });

  it('offers 未読にする for read articles', async () => {
    const onSetRead = setup({ isRead: true });
    await userEvent.click(screen.getByRole('button', { name: '未読にする' }));
    expect(onSetRead).toHaveBeenCalledWith(7, false);
  });

  it('copies the link and shows a toast', async () => {
    setup({ url: 'https://example.com/x' });
    await userEvent.click(screen.getByRole('button', { name: 'リンクをコピー' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/x');
    expect(await screen.findByText('リンクをコピーしました')).toBeInTheDocument();
  });

  it('omits href for non-http urls', () => {
    setup({ title: 'Bad', url: 'javascript:alert(1)' });
    expect(screen.getByText('Bad')).not.toHaveAttribute('href');
  });

  it('shows a failure toast when the clipboard write fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'リンクをコピー' }));
    expect(await screen.findByText('コピーに失敗しました')).toBeInTheDocument();
    expect(screen.queryByText('リンクをコピーしました')).not.toBeInTheDocument();
  });

  it('shows a failure toast when the url is not copyable', async () => {
    setup({ url: 'javascript:alert(1)' });
    await userEvent.click(screen.getByRole('button', { name: 'リンクをコピー' }));
    expect(await screen.findByText('コピーに失敗しました')).toBeInTheDocument();
  });
});
