/**
 * Extract the first image URL from HTML content using DOMParser.
 * Only allows http/https URLs to prevent XSS via data: or javascript: URIs.
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

/** Extract plain-text excerpt from HTML content, trimmed to maxLen chars. */
export function extractTextExcerpt(html: string, maxLen = 80): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen).trimEnd() + '…';
  } catch {
    return '';
  }
}
