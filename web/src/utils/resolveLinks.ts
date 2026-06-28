const DANGEROUS_SCHEME = /^\s*(javascript|data):/i;

export function resolveContentLinks(html: string, articleUrl: string): string {
  if (!html) return html;

  try {
    const baseUrl = new URL(articleUrl);
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
    if (DANGEROUS_SCHEME.test(href)) return;
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
    if (DANGEROUS_SCHEME.test(src)) return;
    try {
      img.setAttribute('src', new URL(src, articleUrl).href);
    } catch {
      // skip
    }
  });

  return doc.body.innerHTML;
}
