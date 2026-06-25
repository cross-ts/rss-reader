/**
 * Format an ISO date string as a relative time string (e.g., "3h ago", "2d ago").
 * Falls back to a short absolute date for older items.
 */
export function relativeTime(iso: string | null): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    const now = Date.now();
    const diff = now - date.getTime();
    if (diff < 0) return 'just now';

    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;

    if (days < 365) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
