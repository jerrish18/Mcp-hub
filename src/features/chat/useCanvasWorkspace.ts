import { useCallback, useEffect, useRef, useState } from 'react';
import { historyDb } from '../../services/storage/historyDb';
import {
  appendCanvasRevision, canvasArtifactId, type CanvasArtifact, type CanvasEditLink,
  type CanvasHistory, type CanvasRevision, type CanvasSource,
} from '../../utils/canvasArtifacts';

interface CanvasSession {
  scope: string;
  artifact: CanvasArtifact;
  history: CanvasHistory;
}

export function useCanvasWorkspace(scope: string) {
  const [session, setSession] = useState<CanvasSession>();
  const [storageError, setStorageError] = useState('');
  const current = useRef<CanvasSession | undefined>(undefined);
  const openToken = useRef(0);
  const writes = useRef<Promise<void>>(Promise.resolve());

  const put = useCallback((next: CanvasSession) => {
    writes.current = writes.current.then(async () => {
      const saved = await historyDb.saveCanvas(next.scope, next.history);
      if (current.current?.scope === next.scope && current.current?.artifact.id === next.artifact.id) {
        setStorageError(saved ? '' : 'Canvas history could not be saved. Export the files to keep a copy.');
      }
    });
    return writes.current;
  }, []);

  const save = useCallback((label = 'Edited source') => {
    const previous = current.current;
    if (!previous) return Promise.resolve();
    const history = appendCanvasRevision(previous.history, previous.artifact, label);
    if (history === previous.history || history.revisions === previous.history.revisions) return writes.current;
    const next = { ...previous, history };
    current.current = next;
    setSession(next);
    return put(next);
  }, [put]);

  useEffect(() => {
    openToken.current++;
    if (current.current && current.current.scope !== scope) {
      void save();
      current.current = undefined;
      setSession(undefined);
      setStorageError('');
    }
  }, [scope, save]);

  const visible = session?.scope === scope ? session : undefined;
  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => void save(), 850);
    return () => window.clearTimeout(timer);
  }, [visible?.artifact, save]);

  useEffect(() => {
    const flush = () => void save();
    window.addEventListener('pagehide', flush);
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      void save();
    };
  }, [save]);

  const open = async (source: CanvasSource, conversationId: string, messageId: string, block: number, link?: CanvasEditLink) => {
    const token = ++openToken.current;
    await save();
    const sourceId = canvasArtifactId(conversationId, messageId, block);
    let linked = link?.kind === source.kind &&
      (source.kind !== 'document' || source.spec.format === link.format);
    let id = linked && link ? link.artifactId : sourceId;
    let history = await historyDb.readCanvas(scope, id);
    if (linked && !history?.revisions.length) {
      linked = false;
      id = sourceId;
      history = await historyDb.readCanvas(scope, id);
    }
    if (token !== openToken.current) return false;
    const incoming = { ...source, id };
    const origin = linked ? messageId : sourceId;
    const prior = history ?? { artifactId: id, revisions: [] };
    const updated = appendCanvasRevision(prior, incoming, linked ? 'AI revision' : 'Original', origin);
    const next = { scope, history: updated, artifact: updated.revisions.at(-1)?.artifact ?? incoming };
    current.current = next;
    setSession(next);
    setStorageError('');
    if (updated !== prior) void put(next);
    return true;
  };

  const change = (artifact: CanvasArtifact) => {
    const active = current.current;
    if (!active || active.scope !== scope || active.artifact.id !== artifact.id) return;
    const next = { ...active, artifact };
    current.current = next;
    setSession(next);
  };

  const restore = (revision: CanvasRevision) => {
    const active = current.current;
    if (!active || active.scope !== scope || active.artifact.id !== revision.artifact.id) return;
    void save();
    change(revision.artifact);
    void save('Restored version');
  };

  return { artifact: visible?.artifact ?? null, revisions: visible?.history.revisions ?? [], open, change, save, restore, storageError };
}
