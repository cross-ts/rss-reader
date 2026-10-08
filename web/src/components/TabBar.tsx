import { Icon } from './Icon';
import { NAVS } from './Nav';
import type { RoutePath } from '../hooks/useHashRoute';

export function TabBar({ active }: { active: RoutePath }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex justify-around border-t border-line bg-bg pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))] sm:hidden">
      {NAVS.map((n) => {
        const on = n.path === active;
        return (
          <a
            key={n.path}
            href={n.href}
            aria-label={n.label}
            className={`rounded-xl px-6 py-2 ${on ? 'text-fg' : 'text-muted'}`}
          >
            <Icon
              name={n.icon}
              className={on ? (n.style === 'fill' ? 'fill-current' : '[stroke-width:2.6]') : ''}
            />
          </a>
        );
      })}
    </nav>
  );
}
