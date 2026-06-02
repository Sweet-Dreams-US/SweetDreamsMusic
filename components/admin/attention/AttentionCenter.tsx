'use client';

import { useState, useEffect } from 'react';
import type { AttentionResponse, AdminTab } from './types';
import AttentionGroup from './AttentionGroup';

/** The "Needs Your Attention" command center. Fetches its own data and
 *  owns loading / error / empty states — independent of the rest of the
 *  overview page. */
export default function AttentionCenter({
  onNavigate,
}: {
  onNavigate: (tab: AdminTab) => void;
}) {
  const [data, setData] = useState<AttentionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/admin/attention')
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((json: AttentionResponse) => setData(json))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="border-2 border-black/10 p-6">
        <div className="font-mono text-sm uppercase tracking-wider text-black/40 animate-pulse">
          Loading your attention items...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="border-2 border-red-200 bg-red-50 p-4">
        <p className="font-mono text-xs text-red-600">
          Couldn&apos;t load attention items. The rest of your dashboard is unaffected.
        </p>
      </div>
    );
  }

  if (data.totalCount === 0) {
    return (
      <div className="border-2 border-black/10 p-6 text-center">
        <p className="font-mono text-sm font-bold uppercase tracking-wider text-black/60">
          Nothing needs your attention right now
        </p>
        <p className="font-mono text-xs text-black/35 mt-1">All clear.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider">
          Needs Your Attention
        </h2>
        <span className="font-mono text-xs text-black/40">
          {data.totalCount} item{data.totalCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="space-y-3">
        {data.groups.map((g) => (
          <AttentionGroup key={g.key} group={g} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}
