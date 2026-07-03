import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsModal } from '../SettingsModal';
import { api, type Settings } from '../../api/client';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual('../../api/client');
  return {
    ...actual,
    api: {
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      previewOpmlImport: vi.fn(),
      importOpml: vi.fn(),
    },
  };
});

const addToastMock = vi.fn();
vi.mock('../Toast', () => ({
  useToast: vi.fn(() => ({ addToast: addToastMock })),
}));

const mockApi = vi.mocked(api);

const testSettings: Settings = {
  host: { value: '127.0.0.1', source: 'default', editable: true, restartRequired: true },
  port: { value: 3000, source: 'default', editable: true, restartRequired: true },
  pollIntervalMinutes: { value: 15, source: 'default', editable: true, restartRequired: true },
  frontendUrl: { value: 'https://example.com', source: 'default', editable: true, restartRequired: true },
  db: { value: '/data/rss.sqlite', source: 'default', editable: false, restartRequired: true },
  feeds: { value: '/data/feeds.opml', source: 'default', editable: false, restartRequired: true },
  staticDir: { value: '', source: 'default', editable: false, restartRequired: true },
};

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SettingsModal', () => {
  it('renders loaded settings with restart badges and read-only paths', async () => {
    mockApi.getSettings.mockResolvedValue(testSettings);

    render(<SettingsModal onClose={vi.fn()} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByDisplayValue('127.0.0.1')).toBeInTheDocument();
    });
    expect(screen.getByText('/data/rss.sqlite')).toBeInTheDocument();
    expect(screen.getAllByText('Requires restart').length).toBeGreaterThan(0);
  });

  it('saves settings and shows a success toast', async () => {
    mockApi.getSettings.mockResolvedValue(testSettings);
    mockApi.updateSettings.mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<SettingsModal onClose={onClose} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByDisplayValue('127.0.0.1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockApi.updateSettings).toHaveBeenCalledWith({
        host: '127.0.0.1',
        port: 3000,
        pollIntervalMinutes: 15,
        frontendUrl: 'https://example.com',
      });
    });
    await waitFor(() => {
      expect(addToastMock).toHaveBeenCalledWith('Saved. Restart the server to apply.', 'success');
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders OPML import/export controls', async () => {
    mockApi.getSettings.mockResolvedValue(testSettings);

    render(<SettingsModal onClose={vi.fn()} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByDisplayValue('127.0.0.1')).toBeInTheDocument();
    });

    expect(screen.getByText('Import OPML')).toBeInTheDocument();
    const exportLink = screen.getByText('Export OPML').closest('a');
    expect(exportLink).toHaveAttribute('href', '/api/opml/export');
  });

  it('keeps Settings open when the OPML import modal is closed via Escape', async () => {
    mockApi.getSettings.mockResolvedValue(testSettings);
    const onClose = vi.fn();

    render(<SettingsModal onClose={onClose} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByDisplayValue('127.0.0.1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Import OPML'));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Import OPML' })).toBeInTheDocument();
    });

    // Escape should close only the import modal, not Settings underneath it.
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Import OPML' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Settings open when the OPML import modal backdrop is clicked', async () => {
    mockApi.getSettings.mockResolvedValue(testSettings);
    const onClose = vi.fn();

    render(<SettingsModal onClose={onClose} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByDisplayValue('127.0.0.1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Import OPML'));

    const importDialog = await screen.findByRole('dialog', { name: 'Import OPML' });
    fireEvent.click(importDialog.parentElement as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Import OPML' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows an error message when saving fails', async () => {
    mockApi.getSettings.mockResolvedValue(testSettings);
    mockApi.updateSettings.mockRejectedValue(new Error('port must be between 1 and 65535'));

    render(<SettingsModal onClose={vi.fn()} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByDisplayValue('127.0.0.1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText('port must be between 1 and 65535')).toBeInTheDocument();
    });
  });
});
