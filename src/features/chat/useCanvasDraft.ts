import type { CanvasArtifact } from './ProCanvasPanel';
import { useCanvasRecord } from './useCanvasRecord';

export function useCanvasDraft(scope: string, conversationId: string | null) {
  const { value, loaded, update, failed, flush } = useCanvasRecord<CanvasArtifact>(
    `mcphub_draft:${JSON.stringify([scope, conversationId])}`
  );
  const artifact = value && typeof value.id === 'string'
    && ['app', 'dataset', 'code', 'document'].includes(value.kind) ? value : null;
  return {
    artifact,
    loaded,
    flush,
    change: (next: CanvasArtifact) => update(() => next),
    saveFailed: failed,
  };
}
