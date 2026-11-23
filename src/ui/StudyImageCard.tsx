import React, { useState } from 'react';
import { ExternalLink, ImageOff, Maximize2, X } from 'lucide-react';

interface StudyImageCardProps {
  url: string;
  alt: string;
  caption?: string;
}

export function StudyImageCard({ url, alt, caption }: StudyImageCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  const safeUrl = url.startsWith('https://') || url.startsWith('http://') ? url : '';
  if (!safeUrl) return null;

  const displayTitle = alt.trim() || caption?.trim() || 'Study Visual Reference';

  return (
    <>
      <figure
        data-testid="study-image-card"
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="my-3 overflow-hidden rounded-2xl border"
      >
        {!failed ? (
          <div className="relative bg-white dark:bg-slate-950/80 flex items-center justify-center p-2 sm:p-3 min-h-[140px]">
            {!loaded && (
              <div className="absolute inset-3 rounded-xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
            )}
            <img
              src={safeUrl}
              alt={displayTitle}
              loading="lazy"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              onError={() => {
                setFailed(true);
                setLoaded(true);
              }}
              className={`max-h-[320px] w-auto max-w-full rounded-xl object-contain transition-opacity duration-200 ${
                loaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {loaded && (
              <button
                type="button"
                onClick={() => setZoomOpen(true)}
                aria-label={`Inspect ${displayTitle} fullscreen`}
                className="absolute top-3 right-3 min-h-[34px] px-2.5 rounded-full bg-slate-900/75 text-white text-[11px] font-medium inline-flex items-center gap-1 hover:bg-slate-900 transition-colors"
              >
                <Maximize2 className="w-3 h-3" />
                <span>Zoom</span>
              </button>
            )}
          </div>
        ) : (
          <div className="p-4 flex items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-2 min-w-0">
              <ImageOff className="w-4 h-4 shrink-0 text-slate-400" />
              <span className="truncate">{displayTitle}</span>
            </span>
            <a
              href={safeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
            >
              <span>Open image</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        <figcaption
          style={{ borderColor: 'var(--m3-outline)' }}
          className="px-3.5 py-2 border-t flex items-center justify-between gap-3 text-xs"
        >
          <div className="min-w-0">
            <div className="font-semibold text-slate-900 dark:text-white truncate">{displayTitle}</div>
            {caption && caption !== displayTitle && (
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {caption}
              </div>
            )}
          </div>
          <a
            href={safeUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open source image for ${displayTitle}`}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
          >
            <span>Source</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </figcaption>
      </figure>

      {zoomOpen && !failed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Fullscreen view: ${displayTitle}`}
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex flex-col p-4 sm:p-6"
          onClick={() => setZoomOpen(false)}
        >
          <div className="flex items-center justify-between gap-3 pb-3 text-white">
            <span className="font-display text-sm font-semibold truncate">{displayTitle}</span>
            <button
              type="button"
              onClick={() => setZoomOpen(false)}
              aria-label="Close fullscreen image"
              className="min-h-[38px] min-w-[38px] rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div
            className="flex-1 min-h-0 flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={safeUrl}
              alt={displayTitle}
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full rounded-2xl object-contain bg-white p-2 shadow-2xl"
            />
          </div>
        </div>
      )}
    </>
  );
}
