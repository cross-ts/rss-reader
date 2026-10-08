/** http/https 以外（javascript: 等）は null にする。 */
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

export function domainOf(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return u || '';
  }
}
