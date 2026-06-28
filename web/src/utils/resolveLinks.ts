export function resolveContentLinks(html: string, articleUrl: string): string {
  if (!html) return html;

  let baseUrl: URL;
  try {
    baseUrl = new URL(articleUrl);
    if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
      return html;
    }
  } catch {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href')!;
    if (href.startsWith('javascript:') || href.startsWith('data:')) return;
    try {
      a.setAttribute('href', new URL(href, articleUrl).href);
    } catch {
      // skip
    }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src')!;
    if (src.startsWith('data:')) return;
    try {
      img.setAttribute('src', new URL(src, articleUrl).href);
    } catch {
      // skip
    }
  });

  return doc.body.innerHTML;
}
