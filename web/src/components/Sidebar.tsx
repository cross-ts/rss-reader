import { Icon, Logo } from './Icon';
import { NAVS } from './Nav';
import type { RoutePath } from '../hooks/useHashRoute';

export function Sidebar({ active }: { active: RoutePath }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[76px] flex-none flex-col items-center gap-2 px-2 py-5 sm:flex lg:w-[300px] lg:items-stretch lg:px-6">
      <a href="#/" aria-label="Home" className="mb-4 lg:mb-5 lg:ml-3">
        <Logo className="size-10" />
      </a>
      {NAVS.map((n) => {
        const on = n.path === active;
        return (
          <a
            key={n.path}
            href={n.href}
            title={n.label}
            className={`flex items-center justify-center gap-[18px] rounded-xl p-[13px] text-[19px] hover:bg-hover hover:text-fg lg:w-full lg:justify-start lg:px-3 ${on ? 'font-bold text-fg' : 'text-muted'}`}
          >
            <Icon
              name={n.icon}
              className={on ? (n.style === 'fill' ? 'fill-current' : '[stroke-width:2.6]') : ''}
            />
            <span className="hidden lg:inline">{n.label}</span>
          </a>
        );
      })}
    </aside>
  );
}
