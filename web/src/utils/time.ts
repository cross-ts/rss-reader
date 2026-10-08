/** ISO 日時を「N分前」「N時間前」「M月D日」「YYYY年M月D日」で表す。不正・null は「日時不明」。 */
export function formatDate(iso: string | null): string {
  if (!iso) return '日時不明';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '日時不明';
  const diff = Date.now() - d.getTime();
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間前`;
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}年${md}`;
}
