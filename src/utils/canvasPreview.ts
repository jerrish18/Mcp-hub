export const CANVAS_PREVIEW_PATH = '/__canvas-preview';
export const CANVAS_IFRAME_SANDBOX =
  'allow-scripts allow-forms allow-modals allow-popups allow-downloads';

export const CANVAS_SCRIPT_ORIGINS = [
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
  'https://cdnjs.cloudflare.com',
  'https://cdn.tailwindcss.com',
  'https://esm.sh',
] as const;

export function openCanvasPreviewInNewTab(html: string): void {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const channel = new BroadcastChannel(`mcphub-preview:${id}`);
  const timer = window.setTimeout(() => channel.close(), 20000);
  channel.onmessage = (event) => {
    if (event.data?.type !== 'ready') return;
    channel.postMessage({ type: 'render', html });
    window.clearTimeout(timer);
    channel.close();
  };
  window.open(`${CANVAS_PREVIEW_PATH}?standalone=1#${id}`, '_blank', 'noopener,noreferrer');
}

export type CanvasPreviewStatus = 'loading' | 'loaded' | 'failed';

export function canvasPushBlockReason({
  exportIssues, requiresPreview, status, runtimeError, reviewed,
}: {
  exportIssues: string[];
  requiresPreview: boolean;
  status: CanvasPreviewStatus;
  runtimeError?: string;
  reviewed: boolean;
}): string | undefined {
  if (exportIssues.length) return exportIssues[0];
  if (!requiresPreview) return;
  if (runtimeError) return runtimeError;
  if (status === 'failed') return 'Open Preview and fix the loading issue before pushing.';
  if (status !== 'loaded') return 'Open Preview to check this revision before pushing.';
  if (!reviewed) return 'Test the primary flow in Preview and confirm it before pushing.';
}
