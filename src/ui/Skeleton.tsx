export function SkeletonCard({ rows = 2 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-800 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/5 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-3/5 rounded bg-slate-100 dark:bg-slate-800/70" />
        </div>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800/70" />
      ))}
    </div>
  );
}
