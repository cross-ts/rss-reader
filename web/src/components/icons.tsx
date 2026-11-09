import type { SVGProps } from 'react';

/**
 * Astryx のセマンティックアイコンに無いグリフ。IconType（SVG コンポーネント）として
 * SideNavItem / Icon / Button に渡す。currentColor の 1.6px ストロークで統一。
 */
function make(d: string, filled = false) {
  return function Glyph(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        <path d={d} />
      </svg>
    );
  };
}

export const HomeIcon = make('M3.5 10.2 12 3.5l8.5 6.7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5z');
export const HomeFilledIcon = make('M3.5 10.2 12 3.5l8.5 6.7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5z', true);
export const StackIcon = make('M4 5.5h16M4 12h16M4 18.5h10');
export const SearchIcon = make('M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.5l-5-5');
export const PlusIcon = make('M12 5v14M5 12h14');
export const FolderIcon = make('M3.5 6.5a1 1 0 0 1 1-1h4.6l2 2h8.4a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z');
export const PencilIcon = make('M4 20h4L19.3 8.7a1.4 1.4 0 0 0 0-2L17.3 4.7a1.4 1.4 0 0 0-2 0L4 16z');
export const TrashIcon = make('M4.5 7h15M10 7V4.5h4V7m-7.5 0 1 12.5h9L17.5 7');
export const RefreshIcon = make('M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5');
export const CircleIcon = make('M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z');
export const LinkIcon = make('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1');
export const RssIcon = make('M5 11a8 8 0 0 1 8 8M5 4.5A14.5 14.5 0 0 1 19.5 19M5.5 19a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z');
