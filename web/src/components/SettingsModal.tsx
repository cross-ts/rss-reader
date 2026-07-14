import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type SettingsUpdate } from '../api/client';
import { useToast } from './Toast';

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const { data: settings, isLoading, isError } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });

  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState('');
  const [frontendUrl, setFrontendUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setHost(settings.host.value);
    setPort(String(settings.port.value));
    setPollIntervalMinutes(String(settings.pollIntervalMinutes.value));
    setFrontendUrl(settings.frontendUrl.value);
  }, [settings]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const updateSettings = useMutation({
    mutationFn: (update: SettingsUpdate) => api.updateSettings(update),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      addToast('Saved. Restart the server to apply.', 'success');
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    },
  });

  const handleSave = () => {
    setError(null);

    if (host.trim() === '') {
      setError('Host must not be empty.');
      return;
    }
    if (!/^\d+$/.test(port.trim()) || Number(port) < 1 || Number(port) > 65535) {
      setError('Port must be an integer between 1 and 65535.');
      return;
    }
    if (!/^\d+$/.test(pollIntervalMinutes.trim()) || Number(pollIntervalMinutes) < 1) {
      setError('Poll interval must be an integer of 1 or more.');
      return;
    }

    updateSettings.mutate({
      host,
      port: Number(port),
      pollIntervalMinutes: Number(pollIntervalMinutes),
      frontendUrl,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center help-overlay-backdrop"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-lg shadow-card-hover p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <h2 id="settings-modal-title" className="text-sm font-semibold text-text-primary mb-4">
          Settings
        </h2>

        {isLoading && <p className="text-xs text-text-sub">Loading...</p>}
        {isError && <p className="text-xs text-danger">Failed to load settings.</p>}

        {settings && (
          <div className="flex flex-col gap-3">
            <SettingField id="settings-host" label="Host" restartRequired={settings.host.restartRequired}>
              <input
                id="settings-host"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                autoFocus
                className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
            </SettingField>

            <SettingField id="settings-port" label="Port" restartRequired={settings.port.restartRequired}>
              <input
                id="settings-port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
            </SettingField>

            <SettingField id="settings-poll-interval" label="Poll interval (minutes)" restartRequired={settings.pollIntervalMinutes.restartRequired}>
              <input
                id="settings-poll-interval"
                type="number"
                value={pollIntervalMinutes}
                onChange={(e) => setPollIntervalMinutes(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
            </SettingField>

            <SettingField id="settings-frontend-url" label="Frontend URL" restartRequired={settings.frontendUrl.restartRequired}>
              <input
                id="settings-frontend-url"
                type="text"
                value={frontendUrl}
                onChange={(e) => setFrontendUrl(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
            </SettingField>

            <SettingField label="Database path" restartRequired={settings.db.restartRequired}>
              <p className="w-full px-2.5 py-1.5 bg-surface-2 border border-border rounded-md text-xs text-text-sub truncate">
                {settings.db.value}
              </p>
            </SettingField>

            <SettingField label="Feeds OPML path" restartRequired={settings.feeds.restartRequired}>
              <p className="w-full px-2.5 py-1.5 bg-surface-2 border border-border rounded-md text-xs text-text-sub truncate">
                {settings.feeds.value}
              </p>
            </SettingField>

            <SettingField label="Static directory" restartRequired={settings.staticDir.restartRequired}>
              <p className="w-full px-2.5 py-1.5 bg-surface-2 border border-border rounded-md text-xs text-text-sub truncate">
                {settings.staticDir.value || '(not set)'}
              </p>
            </SettingField>
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-danger">{error}</p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-text-primary bg-surface-2 border border-border rounded-lg hover:bg-surface-2 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!settings || updateSettings.isPending}
            className="px-4 py-2 text-xs font-semibold text-white bg-accent rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            {updateSettings.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingField({
  id,
  label,
  restartRequired,
  children,
}: {
  id?: string;
  label: string;
  restartRequired: boolean;
  children: React.ReactNode;
}) {
  const labelClassName = "text-[11px] font-semibold uppercase tracking-wide text-text-sub";
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        {id ? (
          <label htmlFor={id} className={labelClassName}>{label}</label>
        ) : (
          <span className={labelClassName}>{label}</span>
        )}
        {restartRequired && (
          <span className="text-[10px] font-medium text-text-sub bg-surface-2 px-1.5 py-0.5 rounded">
            Requires restart
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
