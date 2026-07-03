import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type OpmlPreview } from '../api/client';
import { useToast } from './Toast';

interface Props {
  onClose: () => void;
}

export function OpmlImportModal({ onClose }: Props) {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [xmlText, setXmlText] = useState<string | null>(null);
  const [preview, setPreview] = useState<OpmlPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const previewMutation = useMutation({
    mutationFn: (xml: string) => api.previewOpmlImport(xml),
    onSuccess: (data) => {
      setError(null);
      setPreview(data);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to preview OPML file');
      setXmlText(null);
    },
  });

  const importMutation = useMutation({
    mutationFn: (xml: string) => api.importOpml(xml),
    onSuccess: ({ imported, skipped, invalid }) => {
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      qc.invalidateQueries({ queryKey: ['unreadCounts'] });
      qc.invalidateQueries({ queryKey: ['articles'] });
      const invalidSuffix = invalid > 0 ? `, invalid ${invalid}` : '';
      addToast(`Imported ${imported} feed${imported !== 1 ? 's' : ''}, skipped ${skipped}${invalidSuffix}`, 'success');
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to import OPML file');
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const text = await file.text();
    setXmlText(text);
    previewMutation.mutate(text);
  };

  const handleConfirm = () => {
    if (xmlText) {
      importMutation.mutate(xmlText);
    }
  };

  const handleBack = () => {
    setPreview(null);
    setXmlText(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Mirrors the backend's folderCounts: every non-invalid feed with a
  // folder is counted (duplicates included), so the "No folder" bucket
  // must use the same exclusion (invalid only) to stay consistent with
  // preview.folders[].feedCount.
  const noFolderCount = preview
    ? preview.feeds.filter((f) => f.folder == null && !f.invalid).length
    : 0;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center help-overlay-backdrop"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="opml-import-modal-title"
      >
        <h2 id="opml-import-modal-title" className="text-sm font-semibold text-text-primary mb-4">
          Import OPML
        </h2>

        {!preview && (
          <div>
            <label
              htmlFor="opml-file-input"
              className="text-[11px] font-semibold uppercase tracking-wide text-text-sub"
            >
              OPML file
            </label>
            <input
              id="opml-file-input"
              ref={fileInputRef}
              type="file"
              accept=".opml,.xml"
              onChange={handleFileChange}
              disabled={previewMutation.isPending}
              className="mt-1 w-full text-xs text-text-primary"
            />
            {previewMutation.isPending && (
              <p className="mt-2 text-xs text-text-sub">Reading file...</p>
            )}
          </div>
        )}

        {preview && (
          <div className="flex flex-col gap-3">
            <div className={`grid gap-2 text-center ${preview.invalidFeeds > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <div className="rounded-md bg-surface-2 px-2 py-2">
                <p className="text-lg font-semibold text-text-primary">{preview.totalFeeds}</p>
                <p className="text-[10px] uppercase tracking-wide text-text-sub">Total</p>
              </div>
              <div className="rounded-md bg-surface-2 px-2 py-2">
                <p className="text-lg font-semibold text-text-primary">{preview.newFeeds}</p>
                <p className="text-[10px] uppercase tracking-wide text-text-sub">New</p>
              </div>
              <div className="rounded-md bg-surface-2 px-2 py-2">
                <p className="text-lg font-semibold text-text-primary">{preview.duplicateFeeds}</p>
                <p className="text-[10px] uppercase tracking-wide text-text-sub">Duplicates</p>
              </div>
              {preview.invalidFeeds > 0 && (
                <div className="rounded-md bg-surface-2 px-2 py-2">
                  <p className="text-lg font-semibold text-danger">{preview.invalidFeeds}</p>
                  <p className="text-[10px] uppercase tracking-wide text-text-sub">Invalid</p>
                </div>
              )}
            </div>

            {(preview.folders.length > 0 || noFolderCount > 0) && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-sub mb-1">
                  Folders
                </p>
                <ul className="text-xs text-text-primary flex flex-col gap-1">
                  {preview.folders.map((folder) => (
                    <li key={folder.name} className="flex justify-between">
                      <span>{folder.name}</span>
                      <span className="text-text-sub">{folder.feedCount}</span>
                    </li>
                  ))}
                  {noFolderCount > 0 && (
                    <li className="flex justify-between">
                      <span>No folder</span>
                      <span className="text-text-sub">{noFolderCount}</span>
                    </li>
                  )}
                </ul>
              </div>
            )}

            {preview.duplicateFeeds > 0 && (
              <p className="text-xs text-text-sub">
                Duplicate feeds already in your subscriptions will be skipped.
              </p>
            )}

            {preview.invalidFeeds > 0 && (
              <p className="text-xs text-danger">
                Feeds with an invalid or disallowed URL will be skipped.
              </p>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          {preview ? (
            <>
              <button
                onClick={handleBack}
                disabled={importMutation.isPending}
                className="px-4 py-2 text-xs font-semibold text-text-primary bg-white border border-border rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={importMutation.isPending}
                className="px-4 py-2 text-xs font-semibold text-white bg-accent rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                {importMutation.isPending ? 'Importing...' : 'Confirm import'}
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-text-primary bg-white border border-border rounded-lg hover:bg-surface-2 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
