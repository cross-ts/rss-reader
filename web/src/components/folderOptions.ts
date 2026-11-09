import type { Folder } from '../api/client';

/** フォルダ選択肢。value '' は未分類。"親/子" は全角スペースで字下げする。 */
export function folderOptions(folders: Folder[]) {
  return [
    { value: '', label: '未分類' },
    ...[...folders]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => ({ value: f.name, label: '　'.repeat(f.name.split('/').length - 1) + f.name })),
  ];
}
