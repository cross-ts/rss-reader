import type { ReactNode } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';

/**
 * 各画面の見出し。余白は持たない（Page が padding と gap を持つ）。
 * 見出しと補足は狭い gap で結び、アクションは右端に置く。
 */
export function PageHeader({ title, caption, actions }: { title: string; caption?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="flex min-w-0 grow basis-64 flex-col gap-2">
        <Heading level={1} type="display-2" weight="medium">
          {title}
        </Heading>
        {caption && (
          <Text type="body" color="secondary" as="p" display="block">
            {caption}
          </Text>
        )}
      </div>
      {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * ページの枠。padding はここだけが持ち、子は margin を持たない。
 * 本文カラムは最大 720px、ブロック間は広い gap（8 = 32px）で区切る。
 * 右パネルは xl 以上のみ。本文と同じ上端（コンテナの padding）に揃う。
 */
export function Page({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] gap-16 px-4 pt-10 pb-24 sm:px-8 sm:pt-16">
      <div className="flex min-w-0 max-w-[720px] flex-1 flex-col gap-8">{children}</div>
      {aside && (
        <aside aria-label="サイドパネル" className="hidden w-[300px] flex-none xl:block">
          <div className="sticky top-16">{aside}</div>
        </aside>
      )}
    </div>
  );
}
