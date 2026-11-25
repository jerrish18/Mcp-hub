import { useLayoutEffect, useMemo, useRef } from 'react';
import { CANVAS_IFRAME_SANDBOX, CANVAS_PREVIEW_PATH } from '../../utils/canvasPreview';

export interface CanvasRuntimeLog {
  level: 'error' | 'warn';
  message: string;
  blocking: boolean;
}

interface CanvasPreviewFrameProps {
  title: string;
  testId: string;
  html: string;
  className: string;
  onLoading: () => void;
  onLoaded: () => void;
  onFailed: () => void;
  onLog: (entry: CanvasRuntimeLog) => void;
}

export function CanvasPreviewFrame({
  title, testId, html, className, onLoading, onLoaded, onFailed, onLog,
}: CanvasPreviewFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const frameKey = useMemo(() => Math.random().toString(36), [html]);
  const handlers = useRef({ onLoading, onLoaded, onFailed, onLog });

  useLayoutEffect(() => {
    handlers.current = { onLoading, onLoaded, onFailed, onLog };
  }, [onLoading, onLoaded, onFailed, onLog]);

  useLayoutEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    handlers.current.onLoading();
    let renderSent = false;
    let timeout: number;
    const fail = () => {
      window.clearTimeout(timeout);
      handlers.current.onFailed();
    };
    timeout = window.setTimeout(fail, 8000);

    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || event.origin !== 'null') return;
      const data = event.data;
      if (data?.type === 'mcphub-canvas-ready' && !renderSent) {
        renderSent = true;
        window.clearTimeout(timeout);
        timeout = window.setTimeout(fail, 20000);
        // Opaque sandbox origins require a wildcard destination.
        iframe.contentWindow?.postMessage({ type: 'mcphub-canvas-render', html }, '*');
      } else if (renderSent && data?.source === 'mcphub-canvas-runtime') {
        if (data.type === 'loaded') {
          window.clearTimeout(timeout);
          handlers.current.onLoaded();
        } else if (data.type === 'failed') {
          fail();
        } else if (typeof data.message === 'string' && data.message) {
          handlers.current.onLog({
            level: data.level === 'warn' ? 'warn' : 'error',
            message: data.message.slice(0, 1000),
            blocking: data.blocking === true,
          });
        }
      }
    };

    window.addEventListener('message', receive);
    iframe.src = CANVAS_PREVIEW_PATH;
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, [html]);

  return <iframe key={frameKey} ref={frame} title={title} data-testid={testId}
    sandbox={CANVAS_IFRAME_SANDBOX} className={className} />;
}
