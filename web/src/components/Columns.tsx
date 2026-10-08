import type { ReactNode } from 'react';

export function Columns({ center, right }: { center: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex min-w-0 justify-center">
      <div className="min-h-screen min-w-0 max-w-[750px] flex-[1_1_750px] sm:border-x sm:border-line">{center}</div>
      <aside className="sticky top-0 hidden h-screen min-w-[300px] flex-[0_1_540px] flex-col gap-5 self-start overflow-y-auto px-8 py-5 xl:flex">
        {right}
      </aside>
    </div>
  );
}
