export function SkeletonCard({ rows = 2 }: { rows?: number }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: 'var(--m3-outline)',
      }}
      className="rounded-2xl border p-4 space-y-3 animate-pulse"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-200/70 dark:bg-slate-800 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/5 rounded bg-slate-200/70 dark:bg-slate-800" />
          <div className="h-3 w-3/5 rounded bg-slate-200/50 dark:bg-slate-800/70" />
        </div>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3 w-full rounded bg-slate-200/50 dark:bg-slate-800/70" />
      ))}
    </div>
  );
}
