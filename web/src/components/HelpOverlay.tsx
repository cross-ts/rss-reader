interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'j', desc: 'Next article' },
  { key: 'k', desc: 'Previous article' },
  { key: 'o / Enter', desc: 'Open selected article' },
  { key: 'Esc', desc: 'Close article / clear search' },
  { key: 'm', desc: 'Toggle read / unread' },
  { key: 'n', desc: 'Jump to next unread' },
  { key: 'u', desc: 'Undo mark all read' },
  { key: 'r', desc: 'Refresh feeds' },
  { key: '/', desc: 'Focus search' },
  { key: '?', desc: 'Show this help' },
];

export function HelpOverlay({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center help-overlay-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="bg-white rounded-xl shadow-card-hover border border-border p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-text-primary">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-sub hover:bg-bg-alt hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            aria-label="Close help"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center justify-between py-1.5 px-1">
              <span className="text-sm text-text-primary">{s.desc}</span>
              <kbd className="inline-flex items-center gap-1 px-2 py-0.5 bg-bg-alt border border-border rounded text-xs font-mono text-text-sub">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        <p className="mt-4 text-[11px] text-text-muted text-center">
          Press <kbd className="px-1 py-0.5 bg-bg-alt border border-border rounded text-[10px] font-mono">Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
