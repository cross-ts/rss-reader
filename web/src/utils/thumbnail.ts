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
