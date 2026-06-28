import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IconRail } from '../IconRail';

const views = ['newsfeed', 'search', 'add', 'settings'] as const;
const labels = ['Newsfeed', 'Search', 'Add feed', 'Info'];

function renderRail(activeView: (typeof views)[number] = 'newsfeed', onChangeView = vi.fn()) {
  return { onChangeView, ...render(<IconRail activeView={activeView} onChangeView={onChangeView} />) };
}

describe('IconRail', () => {
  it('renders all four rail buttons', () => {
    renderRail();
    for (const label of labels) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the app logo', () => {
    renderRail();
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it.each(views.map((v, i) => [v, labels[i]] as const))(
    'sets aria-pressed=true only for the active view "%s"',
    (activeView, activeLabel) => {
      renderRail(activeView);
      for (const label of labels) {
        const btn = screen.getByRole('button', { name: label });
        if (label === activeLabel) {
          expect(btn).toHaveAttribute('aria-pressed', 'true');
        } else {
          expect(btn).toHaveAttribute('aria-pressed', 'false');
        }
      }
    },
  );

  it.each(views.map((v, i) => [v, labels[i]] as const))(
    'calls onChangeView with "%s" when the "%s" button is clicked',
    (view, label) => {
      const { onChangeView } = renderRail('newsfeed');
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(onChangeView).toHaveBeenCalledWith(view);
    },
  );

  it('applies active styling class to the active button', () => {
    renderRail('search');
    const searchBtn = screen.getByRole('button', { name: 'Search' });
    expect(searchBtn.className).toContain('bg-icon-rail-active');

    const newsfeedBtn = screen.getByRole('button', { name: 'Newsfeed' });
    expect(newsfeedBtn.className).not.toContain('bg-icon-rail-active');
  });

  it('all buttons have aria-label attributes', () => {
    renderRail();
    for (const label of labels) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-label', label);
    }
  });

  it('all buttons have title attributes', () => {
    renderRail();
    for (const label of labels) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('title', label);
    }
  });
});
