'use client';

import { useState } from 'react';
import { Globe } from 'lucide-react';

interface Props {
  deliverableId: string;
  initialEnabled: boolean;
  profileSlug?: string | null;
}

export default function FileShowcaseToggle({ deliverableId, initialEnabled, profileSlug }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const newState = !enabled;
    setLoading(true);
    try {
      const res = await fetch('/api/profile/showcase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverableId, enabled: newState }),
      });
      const data = await res.json();
      if (data.success) {
        setEnabled(newState);
      } else {
        alert('Failed to update: ' + (data.error || 'Unknown error'));
      }
    } catch {
      alert('Error updating showcase status');
    }
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        disabled={loading}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
          enabled ? 'bg-accent' : 'bg-black/20'
        }`}
        title={enabled ? 'Visible on your public profile' : 'Add to your public profile'}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
      <span className={`font-mono text-[10px] uppercase tracking-wider flex items-center gap-1 ${
        enabled ? 'text-accent font-bold' : 'text-black/30'
      }`}>
        <Globe className="w-3 h-3" />
        {loading ? '...' : enabled ? 'Public' : 'Private'}
      </span>
      {enabled && profileSlug && (
        <a
          href={`/u/${profileSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] text-accent hover:underline no-underline"
        >
          View Profile →
        </a>
      )}
    </div>
  );
}
