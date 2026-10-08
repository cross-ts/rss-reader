const COLORS = ['#e4572e', '#17bebb', '#76b041', '#a05195', '#2f6690', '#d4a017', '#c1456b', '#4a6fa5'];

export function avatarColor(title: string): string {
  let h = 0;
  for (const c of title || '?') h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** 先頭1文字（サロゲートペアも1文字として扱う）。 */
export function initial(title: string): string {
  return [...(title || '?')][0];
}
