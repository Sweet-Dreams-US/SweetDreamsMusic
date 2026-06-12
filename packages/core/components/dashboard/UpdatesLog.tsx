'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { fmtStampDate } from '@/lib/studio-time';

interface UpdateEntry {
  id: string;
  date: string;
  title: string;
  items: string[];
  tags: string[];
}

interface UpdatesLogProps {
  userRole: string;
  isProducer?: boolean;
}

function getVisibleTags(role: string, isProducer?: boolean): string[] {
  const tags = ['all', 'client'];
  if (role === 'engineer' || role === 'admin') tags.push('engineer');
  if (role === 'admin') tags.push('admin');
  if (isProducer || role === 'admin') tags.push('producer');
  return tags;
}

const TAG_COLORS: Record<string, string> = {
  all: 'bg-accent/20 text-accent',
  client: 'bg-blue-100 text-blue-700',
  engineer: 'bg-green-100 text-green-700',
  producer: 'bg-purple-100 text-purple-700',
  admin: 'bg-red-100 text-red-700',
};

const TAG_LABELS: Record<string, string> = {
  all: 'Everyone',
  client: 'Artists',
  engineer: 'Engineers',
  producer: 'Producers',
  admin: 'Admin',
};

export default function UpdatesLog({ userRole, isProducer }: UpdatesLogProps) {
  const [updates, setUpdates] = useState<UpdateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterTag, setFilterTag] = useState<string>('all_visible');

  const visibleTags = useMemo(() => getVisibleTags(userRole, isProducer), [userRole, isProducer]);

  useEffect(() => {
    fetch('/api/updates?per_page=100')
      .then(r => r.json())
      .then(d => {
        setUpdates(d.updates || []);
        // Auto-expand the first entry
        if (d.updates?.length > 0) setExpandedIds(new Set([d.updates[0].id]));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Filter to entries visible to this user's role
  const visibleUpdates = useMemo(() => {
    return updates.filter(u =>
      u.tags.some(tag => visibleTags.includes(tag))
    );
  }, [updates, visibleTags]);

  // Further filter by selected tag
  const filteredUpdates = useMemo(() => {
    if (filterTag === 'all_visible') return visibleUpdates;
    return visibleUpdates.filter(u => u.tags.includes(filterTag));
  }, [visibleUpdates, filterTag]);

  // Group by date
  const grouped = useMemo(() => {
    const map: Record<string, UpdateEntry[]> = {};
    filteredUpdates.forEach(u => {
      const dateKey = fmtStampDate(u.date, { month: 'long', day: 'numeric', year: 'numeric' });
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(u);
    });
    return Object.entries(map);
  }, [filteredUpdates]);

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
        <span className="font-mono text-sm text-black/40 ml-3">Loading updates...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setFilterTag('all_visible')}
          className={`font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 transition-colors ${
            filterTag === 'all_visible' ? 'bg-black text-white' : 'bg-black/5 text-black/40 hover:bg-black/10'
          }`}
        >
          All Updates ({visibleUpdates.length})
        </button>
        {visibleTags.filter(t => t !== 'all').map(tag => (
          <button
            key={tag}
            onClick={() => setFilterTag(tag)}
            className={`font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 transition-colors ${
              filterTag === tag ? 'bg-black text-white' : 'bg-black/5 text-black/40 hover:bg-black/10'
            }`}
          >
            {TAG_LABELS[tag] || tag}
          </button>
        ))}
      </div>

      {/* Updates grouped by date */}
      <div className="space-y-6">
        {grouped.length === 0 && (
          <p className="font-mono text-sm text-black/30 text-center py-12">No updates match this filter</p>
        )}

        {grouped.map(([dateKey, entries]) => (
          <div key={dateKey}>
            <h3 className="font-mono text-xs text-black/30 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-accent rounded-full" />
              {dateKey}
            </h3>

            <div className="space-y-2 ml-4 border-l-2 border-black/5 pl-4">
              {entries.map(update => {
                const isExpanded = expandedIds.has(update.id);
                const hasItems = update.items.length > 0;

                return (
                  <div key={update.id} className="border border-black/10 hover:border-black/20 transition-colors">
                    <button
                      onClick={() => hasItems && toggleExpand(update.id)}
                      className={`w-full p-3 flex items-start justify-between text-left ${hasItems ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] text-black/20">{update.id}</span>
                          {update.tags.map(tag => (
                            <span key={tag} className={`font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 ${TAG_COLORS[tag] || 'bg-black/5 text-black/40'}`}>
                              {TAG_LABELS[tag] || tag}
                            </span>
                          ))}
                        </div>
                        <p className="font-mono text-sm font-semibold mt-1 pr-4">{update.title}</p>
                      </div>
                      {hasItems && (
                        isExpanded ? <ChevronUp className="w-4 h-4 text-black/20 flex-shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-black/20 flex-shrink-0 mt-1" />
                      )}
                    </button>

                    {isExpanded && hasItems && (
                      <div className="border-t border-black/5 px-3 py-2 bg-black/[0.01]">
                        <ul className="space-y-1">
                          {update.items.map((item, i) => (
                            <li key={i} className="font-mono text-xs text-black/60 flex items-start gap-2">
                              <Sparkles className="w-3 h-3 text-accent flex-shrink-0 mt-0.5" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
