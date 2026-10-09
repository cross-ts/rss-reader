/** HOME 中央パネルの UI 案（比較用モック）。PR で比較・選定したら1案に絞る。 */
export const MOCKS = [
  { id: 'current', label: '現行', note: 'Substack 風（pull-to-refresh + 無限スクロール）' },
  { id: 'x', label: 'A 新着ピル', note: 'X / Mastodon: 新着はピルで通知・前回位置に区切り線' },
  { id: 'feedly', label: 'B スクロール既読', note: 'Feedly / Inoreader: 通り過ぎた記事を自動既読・既読は圧縮' },
  { id: 'caughtup', label: 'C 未読→チェック済み', note: 'Instagram: 未読を先に、境界に「すべてチェック済み」' },
  { id: 'inbox', label: 'D 受信箱', note: 'Gmail / NetNewsWire: 未読タブ・ここまで既読・明示的な更新' },
  { id: 'swipe', label: 'E 横スワイプ', note: 'Reeder / Gmail モバイル: 横スワイプで既読、縦はスクロール専用' },
] as const;

export type MockId = (typeof MOCKS)[number]['id'];

const KEY = 'homeMock';

export function loadMock(params: URLSearchParams): MockId {
  const fromHash = params.get('mock');
  let v: string | null = fromHash;
  if (!v) {
    try {
      v = localStorage.getItem(KEY);
    } catch {
      v = null;
    }
  }
  return MOCKS.some((m) => m.id === v) ? (v as MockId) : 'current';
}

export function saveMock(id: MockId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // ignore
  }
}
