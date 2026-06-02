'use client';

import { useState, useEffect } from 'react';
import { FileAudio, Download, Search } from 'lucide-react';
import { fmtStampDate } from '@/lib/studio-time';

interface FileRecord {
  id: string;
  file_name: string;
  display_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  uploaded_by_name: string;
  description: string | null;
  created_at: string;
  user_id: string;
  client_name?: string;
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EngineerFiles() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/engineer/files')
      .then(r => r.json())
      .then(data => setFiles(data.files || []))
      .finally(() => setLoading(false));
  }, []);

  async function handleDownload(file: FileRecord) {
    setDownloading(file.id);
    try {
      const res = await fetch(`/api/engineer/files/download?id=${file.id}`);
      const data = await res.json();
      if (data.url) {
        const a = document.createElement('a');
        a.href = data.url;
        a.download = file.file_name;
        a.click();
      } else {
        alert(data.error || 'Could not generate download link');
      }
    } catch {
      alert('Download failed');
    }
    setDownloading(null);
  }

  const filtered = search
    ? files.filter(f =>
        f.display_name?.toLowerCase().includes(search.toLowerCase()) ||
        f.file_name?.toLowerCase().includes(search.toLowerCase()) ||
        f.client_name?.toLowerCase().includes(search.toLowerCase()) ||
        f.uploaded_by_name?.toLowerCase().includes(search.toLowerCase())
      )
    : files;

  if (loading) return <p className="font-mono text-sm text-black/70">Loading files...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-heading-sm">ALL UPLOADED FILES</h2>
          <p className="font-mono text-xs text-black/60 mt-1">{files.length} file{files.length !== 1 ? 's' : ''} uploaded across all clients</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 border-2 border-black/20 px-3 py-2 focus-within:border-accent">
        <Search className="w-4 h-4 text-black/30" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 font-mono text-sm focus:outline-none"
          placeholder="Search files by name, client..."
        />
      </div>

      {filtered.length === 0 ? (
        <div className="border-2 border-black/10 p-8 text-center">
          <FileAudio className="w-8 h-8 text-black/10 mx-auto mb-3" />
          <p className="font-mono text-sm text-black/70">{search ? 'No files match your search' : 'No files uploaded yet'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(file => (
            <div key={file.id} className="border border-black/10 p-4 hover:border-black/20 transition-colors flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-bold truncate">{file.display_name || file.file_name}</p>
                <div className="font-mono text-xs text-black/60 mt-1 flex items-center gap-3 flex-wrap">
                  {file.client_name && <span>Client: <strong className="text-black/60">{file.client_name}</strong></span>}
                  <span>by {file.uploaded_by_name}</span>
                  <span className="uppercase">{file.file_type?.split('/')[1] || 'file'}</span>
                  {file.file_size > 0 && <span>{formatFileSize(file.file_size)}</span>}
                  <span>{fmtStampDate(file.created_at, { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                </div>
              </div>
              <button
                onClick={() => handleDownload(file)}
                disabled={downloading === file.id}
                className="bg-black text-white font-mono text-xs font-bold uppercase px-4 py-2 hover:bg-black/80 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5 flex-shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                {downloading === file.id ? '...' : 'Download'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
