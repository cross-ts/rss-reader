import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Icon } from '../components/Icon';

/** 未読総数（/api/unread-counts） */
export function useUnreadTotal(): number | undefined {
  return useQuery({ queryKey: ['unreadCounts'], queryFn: api.getUnreadCounts }).data?.total;
}

/** 中央パネル上部に張り付くヘッダー。左にタイトル + 補足、右に操作。下に任意の行（タブ等）。 */
export function HomeHeader({
  sub,
  actions,
  children,
}: {
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="flex min-h-[52px] items-center gap-3 px-3.5 sm:px-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight">Home</h1>
          {sub && <div className="truncate text-xs text-muted">{sub}</div>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function HeaderButton({
  onClick,
  children,
  label,
  primary,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  label?: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`inline-flex flex-none items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] disabled:opacity-40 ${primary ? 'bg-fg font-semibold text-bg' : 'text-muted hover:bg-hover hover:text-fg'}`}
    >
      {children}
    </button>
  );
}

/** 押したときだけ回る更新ボタン（pull-to-refresh の代わり）。 */
export function RefreshButton({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <HeaderButton
      label="更新"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        onRefresh().finally(() => setBusy(false));
      }}
    >
      <Icon name="refresh" small className={busy ? 'animate-spin' : ''} />
    </HeaderButton>
  );
}
