import type { Feed, Folder, UnreadCounts } from '../api/client';

export interface Section {
  key: string; // フォルダ ID または 'none'（未分類）
  folder: Folder | null;
  label: string; // フォルダ名の最後のセグメント
  depth: number;
  feeds: Feed[]; // 絞り込み後
  total: number; // 絞り込み前のフィード数
  unread: number; // 直下フィードの未読合計
}

/** 購読画面の表示用セクションを組み立てる。 */
export function buildSections(
  folders: Folder[],
  feeds: Feed[],
  unread: UnreadCounts | undefined,
  q: string,
): Section[] {
  const query = q.trim().toLowerCase();
  const match = (f: Feed) => !query || `${f.title} ${f.url}`.toLowerCase().includes(query);
  const sum = (list: Feed[]) => list.reduce((n, f) => n + (unread?.feeds[String(f.id)] ?? 0), 0);

  const make = (key: string, folder: Folder | null, all: Feed[]): Section => {
    const segs = folder ? folder.name.split('/') : [];
    return {
      key,
      folder,
      label: folder ? segs[segs.length - 1] : '未分類',
      depth: folder ? segs.length - 1 : 0,
      feeds: all.filter(match),
      total: all.length,
      unread: sum(all),
    };
  };

  const sections = [...folders]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((fo) => make(String(fo.id), fo, feeds.filter((f) => f.folder === fo.name)));
  sections.push(make('none', null, feeds.filter((f) => !f.folder)));

  return sections.filter((s) => (query || s.key === 'none' ? s.feeds.length > 0 : true));
}
