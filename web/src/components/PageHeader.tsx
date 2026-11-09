import type { ReactNode } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';

/** 各画面の見出し。大きな表示書体 + 補足 1 行 + 右端アクション。 */
export function PageHeader({ title, caption, actions }: { title: string; caption?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-x-6 gap-y-4 pt-10 pb-6 sm:pt-16">
      <div className="min-w-0 grow basis-64">
        <Heading level={1} type="display-2" weight="semibold">
          {title}
        </Heading>
        {caption && (
          <div className="mt-2">
            <Text type="body" color="secondary" as="p" display="block">
              {caption}
            </Text>
          </div>
        )}
      </div>
      {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
    </header>
  );
}

/** 読みやすい行長に揃える本文カラム。右パネルは xl 以上でのみ並べる。 */
export function Page({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] gap-16 px-4 pb-24 sm:px-8">
      <div className="min-w-0 max-w-[720px] flex-1">{children}</div>
      {aside && (
        <aside aria-label="サイドパネル" className="hidden w-[300px] flex-none pt-16 xl:block">
          <div className="sticky top-16">{aside}</div>
        </aside>
      )}
    </div>
  );
}
