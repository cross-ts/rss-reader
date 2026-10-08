import { Icon } from './Icon';

/** 右カラムの検索ボックス。Enter で検索ページへ遷移する。 */
export function SearchBox() {
  return (
    <div className="flex items-center gap-2.5 rounded-full border border-line bg-panel px-4 text-muted focus-within:border-accent">
      <Icon name="search" small />
      <input
        type="search"
        placeholder="検索"
        aria-label="検索"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            location.hash = '#/search?q=' + encodeURIComponent(e.currentTarget.value);
          }
        }}
        className="min-w-0 flex-1 border-0 bg-transparent py-[13px] text-fg outline-0"
      />
    </div>
  );
}
