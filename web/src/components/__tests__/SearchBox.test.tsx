import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBox } from '../SearchBox';

describe('SearchBox', () => {
  it('navigates to #/search?q= on Enter', async () => {
    location.hash = '';
    render(<SearchBox />);
    await userEvent.type(screen.getByRole('searchbox'), 'a b{Enter}');
    expect(location.hash).toBe('#/search?q=a%20b');
  });

  it('does not navigate without Enter', async () => {
    location.hash = '';
    render(<SearchBox />);
    await userEvent.type(screen.getByRole('searchbox'), 'abc');
    expect(location.hash).toBe('');
  });
});
