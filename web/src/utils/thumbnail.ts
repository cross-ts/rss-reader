/**
 * HTML 内の最初の img の src を返す。
 * data: / javascript: 等を避けるため http/https のみ許可する。
 */
export function extractThumbnail(html: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const img = doc.querySelector('img');
    if (!img) return null;
    const src = img.getAttribute('src');
    if (!src) return null;
    if (/^https?:\/\//i.test(src)) return src;
    return null;
  } catch {
    return null;
  }
}

const BLOCK_END = /<br\s*\/?>|<\/(p|h[1-6]|li|blockquote|pre|div|ul|ol|tr|table|figure|figcaption)>/gi;

/** HTML からプレーンテキストの抜粋を作る。ブロック要素の境界には空白を入れる。 */
export function extractTextExcerpt(html: string, maxLen = 320): string {
  try {
    const doc = new DOMParser().parseFromString(html.replace(BLOCK_END, '$& '), 'text/html');
    const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen).trimEnd() + '…';
  } catch {
    return '';
  }
}
