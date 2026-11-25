import { useCallback, useEffect, useRef, useState } from 'react';
import { historyDb } from '../../services/storage/historyDb';

interface CanvasRecord<T> {
  key: string;
  value: T | undefined;
}

const writes = new Map<string, Promise<void>>();

export function useCanvasRecord<T>(key: string | undefined) {
  const [record, setRecord] = useState<CanvasRecord<T>>();
  const [failedKey, setFailedKey] = useState<string>();
  const current = useRef<CanvasRecord<T> | undefined>(undefined);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const entry = current.current;
    if (!dirty.current || !entry || entry.value === undefined) return;
    const value = entry.value;
    dirty.current = false;
    const write = (writes.get(entry.key) ?? Promise.resolve()).then(async () => {
      const saved = await historyDb.saveCanvasRecord(entry.key, value);
      if (current.current === entry) {
        dirty.current = !saved;
        setFailedKey(saved ? undefined : entry.key);
      }
    });
    writes.set(entry.key, write);
    void write.finally(() => {
      if (writes.get(entry.key) === write) writes.delete(entry.key);
    });
  }, []);

  useEffect(() => {
    if (!key) return;
    let active = true;
    const initial = current.current;
    if (initial?.key !== key) {
      void (async () => {
        await writes.get(key);
        const value = await historyDb.readCanvasRecord<T>(key);
        if (!active || (current.current?.key === key && current.current !== initial)) return;
        const loaded = { key, value };
        current.current = loaded;
        setRecord(loaded);
      })();
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [key, flush]);

  const update = useCallback((mutate: (previous: T | undefined) => T) => {
    if (!key) return;
    if (current.current?.key !== key) flush();
    const previous = current.current?.key === key ? current.current.value : undefined;
    const value = mutate(previous);
    if (value === previous) return;
    const next = { key, value };
    current.current = next;
    dirty.current = true;
    setRecord(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  }, [key, flush]);

  return {
    value: record?.key === key ? record?.value : undefined,
    loaded: Boolean(record && record.key === key),
    failed: Boolean(failedKey && failedKey === key),
    update,
    flush,
  };
}
