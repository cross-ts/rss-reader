/** ページ群を連結し、id の初出のみを順序を保って残す。 */
export function dedupeById<T extends { id: number }>(pages: { items: T[] }[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const page of pages) {
    for (const a of page.items) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        out.push(a);
      }
    }
  }
  return out;
}
