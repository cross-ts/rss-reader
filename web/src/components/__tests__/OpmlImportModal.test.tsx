import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OpmlImportModal } from '../OpmlImportModal';
import { api, type OpmlPreview } from '../../api/client';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual('../../api/client');
  return {
    ...actual,
    api: {
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

const testPreview: OpmlPreview = {
  totalFeeds: 2,
  newFeeds: 1,
  duplicateFeeds: 1,
  invalidFeeds: 0,
  folders: [{ name: 'Tech', feedCount: 2 }],
  feeds: [
    { title: 'Existing Feed', url: 'https://example.com/existing.xml', folder: 'Tech', duplicate: true, invalid: false },
    { title: 'New Feed', url: 'https://example.com/new.xml', folder: 'Tech', duplicate: false, invalid: false },
  ],
};

const testPreviewWithInvalid: OpmlPreview = {
  totalFeeds: 3,
  newFeeds: 1,
  duplicateFeeds: 1,
  invalidFeeds: 1,
  folders: [{ name: 'Tech', feedCount: 2 }],
  feeds: [
    { title: 'Existing Feed', url: 'https://example.com/existing.xml', folder: 'Tech', duplicate: true, invalid: false },
    { title: 'New Feed', url: 'https://example.com/new.xml', folder: 'Tech', duplicate: false, invalid: false },
    { title: 'Bad Feed', url: 'file:///etc/passwd', folder: null, duplicate: false, invalid: true },
  ],
};

// Backend's folderCounts counts every non-invalid feed with a folder,
// including duplicates. "No folder" must mirror that: exclude only the
// invalid, no-folder feed, and still count the duplicate, no-folder feed.
const testPreviewNoFolderMix: OpmlPreview = {
  totalFeeds: 3,
  newFeeds: 1,
  duplicateFeeds: 1,
  invalidFeeds: 1,
  folders: [],
  feeds: [
    { title: 'Dup No Folder', url: 'https://example.com/dup.xml', folder: null, duplicate: true, invalid: false },
    { title: 'New No Folder', url: 'https://example.com/new.xml', folder: null, duplicate: false, invalid: false },
    { title: 'Bad No Folder', url: 'file:///etc/passwd', folder: null, duplicate: false, invalid: true },
  ],
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

function makeFile(content: string, name = 'feeds.opml') {
  const file = new File([content], name, { type: 'application/xml' });
  // jsdom's File.text() may be missing in some environments; polyfill defensively.
  if (typeof file.text !== 'function') {
    (file as unknown as { text: () => Promise<string> }).text = () => Promise.resolve(content);
  }
  return file;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('OpmlImportModal', () => {
  it('previews an uploaded OPML file and shows counts', async () => {
    mockApi.previewOpmlImport.mockResolvedValue(testPreview);

    render(<OpmlImportModal onClose={vi.fn()} />, { wrapper: createWrapper() });

    const input = screen.getByLabelText('OPML file') as HTMLInputElement;
    const file = makeFile('<opml></opml>');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockApi.previewOpmlImport).toHaveBeenCalledWith('<opml></opml>');
    });

    await waitFor(() => {
      expect(screen.getByText('Confirm import')).toBeInTheDocument();
    });

    expect(screen.getAllByText('2').length).toBeGreaterThan(0); // total + Tech folder count
    expect(screen.getByText('Tech')).toBeInTheDocument();
  });

  it('confirms import and closes the modal on success', async () => {
    mockApi.previewOpmlImport.mockResolvedValue(testPreview);
    mockApi.importOpml.mockResolvedValue({ imported: 1, skipped: 1, invalid: 0 });
    const onClose = vi.fn();

    render(<OpmlImportModal onClose={onClose} />, { wrapper: createWrapper() });

    const input = screen.getByLabelText('OPML file') as HTMLInputElement;
    const file = makeFile('<opml></opml>');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Confirm import')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Confirm import'));

    await waitFor(() => {
      expect(mockApi.importOpml).toHaveBeenCalledWith('<opml></opml>');
    });
    await waitFor(() => {
      expect(addToastMock).toHaveBeenCalledWith('Imported 1 feed, skipped 1', 'success');
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error message when preview fails', async () => {
    mockApi.previewOpmlImport.mockRejectedValue(new Error('invalid OPML'));

    render(<OpmlImportModal onClose={vi.fn()} />, { wrapper: createWrapper() });

    const input = screen.getByLabelText('OPML file') as HTMLInputElement;
    const file = makeFile('not xml');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('invalid OPML')).toBeInTheDocument();
    });
  });

  it('shows invalid feed count in preview and toast when present', async () => {
    mockApi.previewOpmlImport.mockResolvedValue(testPreviewWithInvalid);
    mockApi.importOpml.mockResolvedValue({ imported: 1, skipped: 1, invalid: 1 });

    render(<OpmlImportModal onClose={vi.fn()} />, { wrapper: createWrapper() });

    const input = screen.getByLabelText('OPML file') as HTMLInputElement;
    const file = makeFile('<opml></opml>');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Confirm import')).toBeInTheDocument();
    });

    expect(screen.getByText('Invalid')).toBeInTheDocument();
    expect(screen.getByText('Feeds with an invalid or disallowed URL will be skipped.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Confirm import'));

    await waitFor(() => {
      expect(addToastMock).toHaveBeenCalledWith('Imported 1 feed, skipped 1, invalid 1', 'success');
    });
  });

  it('does not render the Invalid stat when there are no invalid feeds', async () => {
    mockApi.previewOpmlImport.mockResolvedValue(testPreview);

    render(<OpmlImportModal onClose={vi.fn()} />, { wrapper: createWrapper() });

    const input = screen.getByLabelText('OPML file') as HTMLInputElement;
    const file = makeFile('<opml></opml>');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Confirm import')).toBeInTheDocument();
    });

    expect(screen.queryByText('Invalid')).not.toBeInTheDocument();
  });

  it('excludes invalid feeds but includes duplicates in the No folder count', async () => {
    mockApi.previewOpmlImport.mockResolvedValue(testPreviewNoFolderMix);

    render(<OpmlImportModal onClose={vi.fn()} />, { wrapper: createWrapper() });

    const input = screen.getByLabelText('OPML file') as HTMLInputElement;
    const file = makeFile('<opml></opml>');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Confirm import')).toBeInTheDocument();
    });

    // Only the duplicate + new feeds (2) should count toward "No folder";
    // the invalid feed must be excluded, matching the backend's folderCounts.
    expect(screen.getByText('No folder')).toBeInTheDocument();
    const noFolderRow = screen.getByText('No folder').closest('li');
    expect(noFolderRow).not.toBeNull();
    expect(noFolderRow!.textContent).toContain('2');
  });

  it('clicking the backdrop stops propagation and only calls its own onClose', async () => {
    mockApi.previewOpmlImport.mockResolvedValue(testPreview);
    const onClose = vi.fn();
    const parentOnClick = vi.fn();

    render(
      <div onClick={parentOnClick}>
        <OpmlImportModal onClose={onClose} />
      </div>,
      { wrapper: createWrapper() },
    );

    const dialog = screen.getByRole('dialog');
    // The backdrop is the dialog's parent element.
    fireEvent.click(dialog.parentElement as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(parentOnClick).not.toHaveBeenCalled();
  });
});
