import { MOCKS, type MockId } from './mocks';

/** 比較用: UI 案を切り替えるチップ列。 */
export function MockSwitcher({ value, onChange }: { value: MockId; onChange: (id: MockId) => void }) {
  const note = MOCKS.find((m) => m.id === value)?.note;
  return (
    <div className="border-b border-dashed border-line bg-panel px-3.5 py-2 sm:px-5">
      <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {MOCKS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            aria-pressed={m.id === value}
            className={`flex-none rounded-full border px-3 py-1 text-xs ${m.id === value ? 'border-fg bg-fg text-bg' : 'border-line text-muted hover:text-fg'}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">MOCK · {note}</p>
    </div>
  );
}
