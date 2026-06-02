'use client';

import { useState, useEffect, useMemo } from 'react';
import { Search, Upload, Plus, Trash2, FileAudio, StickyNote, ChevronLeft, Download } from 'lucide-react';
import { fmtStampDate } from '@/lib/studio-time';

interface Client {
  id: string;
  user_id: string;
  display_name: string;
  profile_picture_url: string | null;
  files_count: number;
  notes_count: number;
}

interface Deliverable {
  id: string;
  file_name: string;
  display_name: string;
  file_size: number;
  file_type: string;
  uploaded_by_name: string;
  description: string | null;
  created_at: string;
}

interface Note {
  id: string;
  admin_name: string;
  note_content: string;
  created_at: string;
  category: string;
}

const NOTE_CATEGORIES = ['general', 'feedback', 'audio', 'mixing', 'mastering', 'planning'];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ClientLibrary() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingData, setLoadingData] = useState(false);

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Note state
  const [showNote, setShowNote] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState('general');
  const [addingNote, setAddingNote] = useState(false);

  useEffect(() => {
    fetch('/api/admin/library/clients')
      .then((r) => r.json())
      .then((d) => setClients(d.clients || []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter((c) => c.display_name.toLowerCase().includes(q));
  }, [clients, search]);

  async function selectClient(client: Client) {
    setSelectedClient(client);
    setLoadingData(true);
    const [filesRes, notesRes] = await Promise.all([
      fetch(`/api/admin/library/deliverables?user_id=${client.user_id}`),
      fetch(`/api/admin/library/notes?user_id=${client.user_id}`),
    ]);
    const [filesData, notesData] = await Promise.all([filesRes.json(), notesRes.json()]);
    setDeliverables(filesData.deliverables || []);
    setNotes(notesData.notes || []);
    setLoadingData(false);
  }

  async function handleUpload() {
    if (uploadFiles.length === 0 || !selectedClient) return;
    setUploading(true);

    try {
      const newDeliverables: typeof deliverables = [];

      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        setUploadProgress(`Uploading ${i + 1} of ${uploadFiles.length}: ${file.name}`);

        const urlRes = await fetch('/api/admin/library/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, userId: selectedClient.user_id }),
        });
        const urlData = await urlRes.json();
        if (!urlRes.ok) { alert(`Failed: ${urlData.error}`); continue; }

        const uploadRes = await fetch(urlData.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!uploadRes.ok) { alert(`Upload failed for ${file.name}`); continue; }

        const formData = new FormData();
        formData.append('user_id', urlData.userId);
        formData.append('file_name', file.name);
        formData.append('file_path', urlData.filePath);
        formData.append('file_size', String(file.size));
        formData.append('file_type', file.type);
        formData.append('display_name', file.name);
        formData.append('skip_upload', 'true');

        const res = await fetch('/api/admin/library/deliverables', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.deliverable) newDeliverables.push(data.deliverable);
      }

      setDeliverables((prev) => [...newDeliverables, ...prev]);
      setUploadFiles([]);
      setUploadProgress('');
      setShowUpload(false);
    } catch (err) {
      console.error('Upload error:', err);
      alert('Upload failed. Please try again.');
    }
    setUploading(false);
    setUploadProgress('');
  }

  async function handleAddNote() {
    if (!noteContent.trim() || !selectedClient) return;
    setAddingNote(true);
    const res = await fetch('/api/admin/library/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedClient.user_id, content: noteContent, category: noteCategory }),
    });
    const data = await res.json();
    if (data.note) {
      setNotes((prev) => [data.note, ...prev]);
      setNoteContent('');
      setShowNote(false);
    }
    setAddingNote(false);
  }

  async function downloadFile(id: string, fileName: string) {
    try {
      const res = await fetch(`/api/engineer/files/download?id=${id}`);
      const data = await res.json();
      if (data.url) {
        const link = document.createElement('a');
        link.href = data.url;
        link.download = fileName;
        link.click();
      } else {
        alert('Could not generate download link');
      }
    } catch {
      alert('Download failed');
    }
  }

  async function deleteFile(id: string) {
    if (!confirm('Delete this file?')) return;
    await fetch('/api/admin/library/deliverables', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setDeliverables((prev) => prev.filter((d) => d.id !== id));
  }

  async function deleteNote(id: string) {
    if (!confirm('Delete this note?')) return;
    await fetch('/api/admin/library/notes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  // Client list view
  if (!selectedClient) {
    return (
      <div>
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-black/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="w-full border-2 border-black/20 pl-10 pr-4 py-3 font-mono text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <span className="font-mono text-xs text-black/60">{filtered.length} clients</span>
        </div>

        {loading ? (
          <p className="font-mono text-sm text-black/70">Loading clients...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((client) => (
              <button
                key={client.id}
                onClick={() => selectClient(client)}
                className="border-2 border-black/10 p-4 text-left hover:border-black/30 transition-colors flex items-center gap-4"
              >
                <div className="w-10 h-10 bg-black/5 flex items-center justify-center flex-shrink-0">
                  {client.profile_picture_url ? (
                    <img src={client.profile_picture_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-heading text-lg text-black/20">{client.display_name?.[0]}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm font-semibold truncate">{client.display_name}</p>
                  <p className="font-mono text-xs text-black/60">
                    {client.files_count} files · {client.notes_count} notes
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Client detail view
  return (
    <div>
      <button
        onClick={() => { setSelectedClient(null); setDeliverables([]); setNotes([]); }}
        className="font-mono text-sm text-black/50 hover:text-black mb-6 inline-flex items-center gap-1"
      >
        <ChevronLeft className="w-4 h-4" /> Back to clients
      </button>

      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 bg-black/5 flex items-center justify-center">
          {selectedClient.profile_picture_url ? (
            <img src={selectedClient.profile_picture_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="font-heading text-xl text-black/20">{selectedClient.display_name?.[0]}</span>
          )}
        </div>
        <h2 className="text-heading-lg">{selectedClient.display_name}</h2>
      </div>

      {loadingData ? (
        <p className="font-mono text-sm text-black/40">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Files */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
                <FileAudio className="w-4 h-4 text-accent" /> Files ({deliverables.length})
              </h3>
              <button
                onClick={() => setShowUpload(!showUpload)}
                className="font-mono text-xs font-bold text-accent hover:underline inline-flex items-center gap-1"
              >
                <Upload className="w-3 h-3" /> Upload
              </button>
            </div>

            {showUpload && (
              <div className="border-2 border-accent p-4 mb-4 space-y-3">
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const files = Array.from(e.dataTransfer.files);
                    setUploadFiles(prev => [...prev, ...files]);
                  }}
                  className={`border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                    isDragging ? 'border-accent bg-accent/10' : 'border-black/20 hover:border-accent'
                  }`}
                >
                  <label className="cursor-pointer block">
                    <p className="font-mono text-xs font-bold uppercase tracking-wider mb-1">
                      {isDragging ? 'Drop files here' : 'Drag & drop files here'}
                    </p>
                    <p className="font-mono text-[10px] text-black/40">or click to browse — WAV, MP3, FLAC, ZIP</p>
                    <input
                      type="file"
                      accept="audio/*,.wav,.mp3,.flac,.aiff,.m4a,.zip"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        setUploadFiles(prev => [...prev, ...files]);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
                {uploadFiles.length > 0 && (
                  <div className="space-y-1">
                    {uploadFiles.map((file, i) => (
                      <div key={`${file.name}-${i}`} className="flex items-center justify-between py-1.5 px-2 bg-white border border-black/10">
                        <span className="font-mono text-xs truncate">{file.name}</span>
                        <button
                          onClick={() => setUploadFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="font-mono text-[10px] text-red-500 hover:underline ml-2 flex-shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={handleUpload}
                  disabled={uploadFiles.length === 0 || uploading}
                  className="bg-black text-white font-mono text-xs font-bold uppercase px-4 py-2 hover:bg-black/80 disabled:opacity-50"
                >
                  {uploading ? (uploadProgress || 'Uploading...') : `Upload ${uploadFiles.length || ''} File${uploadFiles.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            )}

            <div className="space-y-2">
              {deliverables.map((file) => (
                <div key={file.id} className="border border-black/10 p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold truncate">{file.display_name || file.file_name}</p>
                    <p className="font-mono text-[10px] text-black/40">
                      {formatFileSize(file.file_size)} · by {file.uploaded_by_name} · {fmtStampDate(file.created_at)}
                    </p>
                    {file.description && <p className="font-mono text-[10px] text-black/50 mt-1">{file.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => downloadFile(file.id, file.file_name)} className="text-accent hover:text-accent/70 p-1" title="Download">
                      <Download className="w-3 h-3" />
                    </button>
                    <button onClick={() => deleteFile(file.id)} className="text-red-400 hover:text-red-600 p-1" title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              {deliverables.length === 0 && (
                <p className="font-mono text-xs text-black/30 py-4 text-center">No files yet</p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-accent" /> Notes ({notes.length})
              </h3>
              <button
                onClick={() => setShowNote(!showNote)}
                className="font-mono text-xs font-bold text-accent hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Note
              </button>
            </div>

            {showNote && (
              <div className="border-2 border-accent p-4 mb-4 space-y-3">
                <select
                  value={noteCategory}
                  onChange={(e) => setNoteCategory(e.target.value)}
                  className="w-full border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
                >
                  {NOTE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Write a note..."
                  rows={3}
                  className="w-full border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none resize-vertical"
                />
                <button
                  onClick={handleAddNote}
                  disabled={!noteContent.trim() || addingNote}
                  className="bg-black text-white font-mono text-xs font-bold uppercase px-4 py-2 hover:bg-black/80 disabled:opacity-50"
                >
                  {addingNote ? 'Adding...' : 'Add Note'}
                </button>
              </div>
            )}

            <div className="space-y-2">
              {notes.map((note) => (
                <div key={note.id} className="border border-black/10 p-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <span className="font-mono text-[10px] bg-black/5 px-2 py-0.5 uppercase tracking-wider">{note.category}</span>
                      <p className="font-mono text-xs mt-2">{note.note_content}</p>
                      <p className="font-mono text-[10px] text-black/40 mt-1">
                        {note.admin_name} · {fmtStampDate(note.created_at)}
                      </p>
                    </div>
                    <button onClick={() => deleteNote(note.id)} className="text-red-400 hover:text-red-600 flex-shrink-0 p-1">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              {notes.length === 0 && (
                <p className="font-mono text-xs text-black/30 py-4 text-center">No notes yet</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
