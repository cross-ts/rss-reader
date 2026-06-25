import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'rss.read';

function loadReadIds(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((v): v is number => typeof v === 'number'));
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage full or disabled -- ignore silently
  }
}

export function useReadState() {
  const [readIds, setReadIds] = useState<Set<number>>(loadReadIds);

  // Sync to localStorage whenever readIds changes
  useEffect(() => {
    saveReadIds(readIds);
  }, [readIds]);

  const isRead = useCallback(
    (id: number): boolean => readIds.has(id),
    [readIds],
  );

  const markRead = useCallback((id: number): void => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const markAllRead = useCallback((ids: number[]): void => {
    setReadIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  return { isRead, markRead, markAllRead, readIds } as const;
}
