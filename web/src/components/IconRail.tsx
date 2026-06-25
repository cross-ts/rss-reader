interface Props {
  activeView: 'newsfeed' | 'search' | 'add' | 'settings';
  onChangeView: (view: 'newsfeed' | 'search' | 'add' | 'settings') => void;
}

function RailButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={[
        'w-10 h-10 flex items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
        active
          ? 'bg-icon-rail-active text-white'
          : 'text-gray-400 hover:bg-icon-rail-hover hover:text-gray-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function IconRail({ activeView, onChangeView }: Props) {
  return (
    <aside className="w-14 bg-icon-rail flex flex-col items-center py-4 gap-1 flex-shrink-0">
      {/* App logo / initial */}
      <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm mb-4">
        R
      </div>

      {/* Newsfeed (all articles) */}
      <RailButton
        active={activeView === 'newsfeed'}
        onClick={() => onChangeView('newsfeed')}
        title="Newsfeed"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
        </svg>
      </RailButton>

      {/* Search */}
      <RailButton
        active={activeView === 'search'}
        onClick={() => onChangeView('search')}
        title="Search"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </RailButton>

      {/* Add feed */}
      <RailButton
        active={activeView === 'add'}
        onClick={() => onChangeView('add')}
        title="Add feed"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </RailButton>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings / Info */}
      <RailButton
        active={activeView === 'settings'}
        onClick={() => onChangeView('settings')}
        title="Info"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </RailButton>
    </aside>
  );
}
