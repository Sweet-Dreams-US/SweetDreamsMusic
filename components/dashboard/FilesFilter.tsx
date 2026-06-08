'use client';

import { useState, useMemo } from 'react';
import { Search, SlidersHorizontal, ArrowUpDown, X, Download } from 'lucide-react';
import { fmtStampDate } from '@/lib/studio-time';
import FileShowcaseToggle from '@/components/dashboard/FileShowcaseToggle';

// NOTE: this is a Client Component that renders the file list ITSELF. It must NOT
// take a render-prop / function child — the parent (app/dashboard/files/page.tsx)
// is a Server Component, and a function can't be serialized across the RSC
// boundary (Next throws "Functions cannot be passed directly to Client
// Components" → a server-side exception). So the page passes plain serializable
// data (downloadUrl + isPublic already resolved) and we own all the rendering.

interface FileItem {
  id: string;
  file_name: string;
  display_name: string | null;
  file_type: string | null;
  file_size: number;
  uploaded_by_name: string | null;
  description: string | null;
  created_at: string;
  downloadUrl: string | null;
  isPublic: boolean;
}

type SortField = 'date' | 'name' | 'size' | 'type';
type SortDir = 'asc' | 'desc';
type FileTypeFilter = 'all' | 'audio' | 'stems' | 'other';

interface FilesFilterProps {
  files: FileItem[];
  profileSlug?: string;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilesFilter({ files, profileSlug }: FilesFilterProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>('all');
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    let result = [...files];

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(f =>
        (f.display_name || f.file_name || '').toLowerCase().includes(q) ||
        (f.uploaded_by_name || '').toLowerCase().includes(q) ||
        (f.description || '').toLowerCase().includes(q)
      );
    }

    if (typeFilter === 'audio') {
      result = result.filter(f => f.file_type?.startsWith('audio/') && !f.file_name?.toLowerCase().includes('stem'));
    } else if (typeFilter === 'stems') {
      result = result.filter(f =>
        f.file_name?.toLowerCase().includes('stem') ||
        f.file_name?.toLowerCase().includes('trackout') ||
        f.file_type?.includes('zip')
      );
    } else if (typeFilter === 'other') {
      result = result.filter(f => !f.file_type?.startsWith('audio/') && !f.file_type?.includes('zip'));
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case 'name':
          cmp = (a.display_name || a.file_name || '').localeCompare(b.display_name || b.file_name || '');
          break;
        case 'size':
          cmp = a.file_size - b.file_size;
          break;
        case 'type':
          cmp = (a.file_type || '').localeCompare(b.file_type || '');
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [files, search, sortField, sortDir, typeFilter]);

  // Group the filtered files by date for display.
  const grouped: Record<string, FileItem[]> = {};
  filtered.forEach(file => {
    const dateKey = fmtStampDate(file.created_at, { month: 'long', day: 'numeric', year: 'numeric' }) || 'Recent';
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(file);
  });

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  const hasActiveFilters = search || typeFilter !== 'all' || sortField !== 'date';

  return (
    <div>
      {/* Search + toggle */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files by name, engineer, or description..."
            className="w-full border-2 border-black/10 pl-10 pr-4 py-2.5 font-mono text-sm focus:border-accent focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-black/30 hover:text-black">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`border-2 px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors ${
            showFilters || hasActiveFilters ? 'border-accent bg-accent/10 text-accent' : 'border-black/10 text-black/40 hover:border-black/30'
          }`}
        >
          <SlidersHorizontal className="w-3 h-3" /> Filter
        </button>
      </div>

      {/* Filter/sort controls */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-black/10">
          <div className="flex gap-1">
            {([
              { key: 'all', label: 'All' },
              { key: 'audio', label: 'Audio' },
              { key: 'stems', label: 'Stems/Trackouts' },
              { key: 'other', label: 'Other' },
            ] as const).map(opt => (
              <button
                key={opt.key}
                onClick={() => setTypeFilter(opt.key)}
                className={`font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 transition-colors ${
                  typeFilter === opt.key ? 'bg-black text-white' : 'bg-black/5 text-black/40 hover:bg-black/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex gap-1 ml-auto">
            {([
              { key: 'date', label: 'Date' },
              { key: 'name', label: 'Name' },
              { key: 'size', label: 'Size' },
            ] as const).map(opt => (
              <button
                key={opt.key}
                onClick={() => toggleSort(opt.key)}
                className={`font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 inline-flex items-center gap-1 transition-colors ${
                  sortField === opt.key ? 'bg-accent text-black' : 'bg-black/5 text-black/40 hover:bg-black/10'
                }`}
              >
                {opt.label}
                {sortField === opt.key && <ArrowUpDown className="w-3 h-3" />}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(''); setTypeFilter('all'); setSortField('date'); setSortDir('desc'); }}
              className="font-mono text-[10px] text-red-500 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Results count */}
      <div className="flex items-center justify-between mb-2">
        <p className="font-mono text-[10px] text-black/30">
          {filtered.length === files.length
            ? `${files.length} file${files.length !== 1 ? 's' : ''}`
            : `${filtered.length} of ${files.length} files`}
        </p>
      </div>

      {/* File list (grouped by date) */}
      {filtered.length === 0 ? (
        <div className="border-2 border-black/10 p-8 text-center">
          <p className="font-mono text-sm text-black/70">No files match your search</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([date, dateFiles]) => (
            <div key={date}>
              <h3 className="font-mono text-xs text-black/60 uppercase tracking-wider mb-3 border-b border-black/10 pb-2">
                {date} — {dateFiles.length} file{dateFiles.length > 1 ? 's' : ''}
              </h3>
              <div className="space-y-2">
                {dateFiles.map(file => (
                  <div key={file.id} className="border-2 border-black/10 p-4 hover:border-black/30 transition-colors">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-bold truncate">
                          {file.display_name || file.file_name}
                        </p>
                        <div className="font-mono text-xs text-black/60 mt-1 flex items-center gap-3 flex-wrap">
                          <span>by {file.uploaded_by_name || 'Sweet Dreams'}</span>
                          <span className="uppercase">{file.file_type?.split('/')[1] || 'file'}</span>
                          {file.file_size > 0 && <span>{formatFileSize(file.file_size)}</span>}
                        </div>
                        {file.description && (
                          <p className="font-mono text-[10px] text-black/60 mt-1">{file.description}</p>
                        )}
                      </div>
                      {file.downloadUrl ? (
                        <a
                          href={file.downloadUrl}
                          download={file.file_name}
                          className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-accent/90 transition-colors inline-flex items-center gap-2 flex-shrink-0 no-underline"
                        >
                          <Download className="w-4 h-4" /> Download
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-black/60">Unavailable</span>
                      )}
                    </div>
                    {file.file_type?.startsWith('audio/') && (
                      <div className="mt-3 pt-3 border-t border-black/5">
                        <FileShowcaseToggle
                          deliverableId={file.id}
                          initialEnabled={file.isPublic}
                          profileSlug={profileSlug}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
