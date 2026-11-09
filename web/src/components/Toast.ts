import { useCallback } from 'react';
import { useToast as useAstryxToast } from '@astryxdesign/core/Toast';

/** 文字列だけで出せる Astryx Toast の薄いラッパ。hooks からはこれを使う。 */
export function useToast() {
  const show = useAstryxToast();
  return useCallback(
    (message: string, type: 'info' | 'error' = 'info') => {
      show({ body: message, type, uniqueID: message, isAutoHide: true });
    },
    [show],
  );
}
