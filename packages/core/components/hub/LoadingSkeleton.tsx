'use client';

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="border-2 border-black/10 p-5 space-y-3">
      {/* Title block */}
      <div className="h-4 w-1/3 bg-black/5 animate-pulse rounded" />
      {/* Content lines */}
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 bg-black/5 animate-pulse rounded"
          style={{ width: `${85 - i * 12}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={2} />
      ))}
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="border-2 border-black/10 p-5">
      {/* Chart title */}
      <div className="h-4 w-1/4 bg-black/5 animate-pulse rounded mb-6" />
      {/* Bar chart rectangles */}
      <div className="flex items-end gap-2 h-40">
        {[60, 80, 45, 90, 70, 55, 85, 40, 75, 65, 50, 88].map((h, i) => (
          <div
            key={i}
            className="flex-1 bg-black/5 animate-pulse rounded-t"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      {/* X-axis labels */}
      <div className="flex gap-2 mt-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex-1 h-2 bg-black/5 animate-pulse rounded" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonCalendar() {
  return (
    <div className="border-2 border-black/10 p-5">
      {/* Month header */}
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 w-24 bg-black/5 animate-pulse rounded" />
        <div className="flex gap-2">
          <div className="h-6 w-6 bg-black/5 animate-pulse rounded" />
          <div className="h-6 w-6 bg-black/5 animate-pulse rounded" />
        </div>
      </div>
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-3 bg-black/5 animate-pulse rounded" />
        ))}
      </div>
      {/* Calendar grid (5 rows x 7 cols) */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="aspect-square bg-black/5 animate-pulse rounded" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-2 border-black/10 p-4 aspect-square flex flex-col justify-between">
          <div className="h-8 w-8 bg-black/5 animate-pulse rounded" />
          <div className="space-y-2">
            <div className="h-3 w-3/4 bg-black/5 animate-pulse rounded" />
            <div className="h-2 w-1/2 bg-black/5 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
