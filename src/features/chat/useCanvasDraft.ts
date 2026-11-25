import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasArtifact } from './ProCanvasPanel';

function readDraft(key: string): CanvasArtifact | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return value && typeof value.id === 'string' && ['app', 'dataset', 'code', 'document'].includes(value.kind) ? value : null;
  } catch { return null; }
}

export function useCanvasDraft(scope: string, conversationId: string | null) {
  const key = `mcphub_draft:${JSON.stringify([scope, conversationId])}`;
  const initial = useMemo(() => readDraft(key), [key]);
  const [draft, setDraft] = useState<{ key: string; artifact: CanvasArtifact }>();
  const [failedKey, setFailedKey] = useState<string>();
  const pending = useRef<{ key: string; artifact: CanvasArtifact } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const entry = pending.current;
    if (!entry) return;
    try {
      localStorage.setItem(entry.key, JSON.stringify(entry.artifact));
      pending.current = undefined;
      setFailedKey(undefined);
    } catch { setFailedKey(entry.key); }
  }, []);
  const change = useCallback((artifact: CanvasArtifact) => {
    if (pending.current && pending.current.key !== key) flush();
    const entry = { key, artifact };
    setDraft(entry);
    pending.current = entry;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  }, [key, flush]);
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [key, flush]);
  return { artifact: draft?.key === key ? draft.artifact : initial, change, saveFailed: failedKey === key };
}
