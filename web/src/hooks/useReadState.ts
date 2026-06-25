import { useState, useCallback, useEffect, useRef } from 'react';

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
  // Snapshot of readIds before the last markAllRead, for undo
  const undoSnapshotRef = useRef<Set<number> | null>(null);

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

  const toggleRead = useCallback((id: number): void => {
    setReadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /**
   * Mark all given ids as read. Returns the count of newly-marked ids.
   * Saves a snapshot so the operation can be undone.
   */
  const markAllRead = useCallback((ids: number[]): number => {
    let count = 0;
    setReadIds((prev) => {
      undoSnapshotRef.current = new Set(prev);
      const next = new Set(prev);
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          count++;
        }
      }
      return count > 0 ? next : prev;
    });
    return count;
  }, []);

  /** Undo the last markAllRead. Returns true if undo was performed. */
  const undoMarkAllRead = useCallback((): boolean => {
    const snapshot = undoSnapshotRef.current;
    if (!snapshot) return false;
    setReadIds(snapshot);
    undoSnapshotRef.current = null;
    return true;
  }, []);

  /** Whether an undo is available */
  const canUndo = undoSnapshotRef.current !== null;

  return { isRead, markRead, toggleRead, markAllRead, undoMarkAllRead, canUndo, readIds } as const;
}
