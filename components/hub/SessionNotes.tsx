'use client';

import { useState, useEffect } from 'react';
import { FileText, Plus, Check, MessageSquare, Music, Eye, EyeOff } from 'lucide-react';
import { formatDuration } from '@/lib/utils';

interface SessionNote {
  id: string;
  booking_id: string;
  author_type: 'engineer' | 'artist';
  content: string;
  what_was_worked_on: string | null;
  next_steps: string | null;
  linked_project_id: string | null;
  is_visible_to_client: boolean;
  created_at: string;
}

interface CompletedSession {
  id: string;
  start_time: string;
  duration: number;
  room: string | null;
  engineer_name: string | null;
  notes: SessionNote[];
}

interface Project {
  id: string;
  title: string;
}

export default function SessionNotes({ onXpEarned, isEngineer = false }: { onXpEarned?: () => void; isEngineer?: boolean }) {
  const [sessions, setSessions] = useState<CompletedSession[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedForm, setExpandedForm] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Form state
  const [content, setContent] = useState('');
  const [workedOn, setWorkedOn] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [linkedProject, setLinkedProject] = useState('');
  const [visibleToClient, setVisibleToClient] = useState(true);
  const [togglingVisibility, setTogglingVisibility] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [notesRes, overviewRes] = await Promise.all([
          fetch('/api/hub/session-notes'),
          fetch('/api/hub/overview'),
        ]);
        const notesData = await notesRes.json();
        const overviewData = await overviewRes.json();

        // Merge notes into completed sessions
        const completedSessions: CompletedSession[] = (overviewData.completedSessions || []).map(
          (s: any) => ({
            ...s,
            notes: (notesData.notes || []).filter((n: SessionNote) => n.booking_id === s.id),
          })
        );

        setSessions(completedSessions);
        setProjects(overviewData.projects || []);
      } catch (err) {
        console.error('Failed to load session notes:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function resetForm() {
    setContent('');
    setWorkedOn('');
    setNextSteps('');
    setLinkedProject('');
    setVisibleToClient(true);
    setExpandedForm(null);
  }

  async function handleSave(bookingId: string) {
    if (!content.trim()) return;
    setSaving(bookingId);

    try {
      const res = await fetch('/api/hub/session-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: bookingId,
          content: content.trim(),
          what_was_worked_on: workedOn.trim() || null,
          next_steps: nextSteps.trim() || null,
          linked_project_id: linkedProject || null,
          is_visible_to_client: visibleToClient,
        }),
      });

      if (!res.ok) throw new Error('Failed to save note');

      const newNote = await res.json();

      // Award XP for logging session notes
      try {
        await fetch('/api/hub/xp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'log_session_notes' }),
        });
        onXpEarned?.();
      } catch { /* silent */ }

      // Update local state
      setSessions((prev) =>
        prev.map((s) =>
          s.id === bookingId
            ? { ...s, notes: [...s.notes, newNote.note || newNote] }
            : s
        )
      );

      resetForm();
      setSaved(bookingId);
      setTimeout(() => setSaved(null), 2000);
    } catch (err) {
      console.error('Failed to save note:', err);
    } finally {
      setSaving(null);
    }
  }

  async function toggleVisibility(noteId: string, currentValue: boolean) {
    setTogglingVisibility(noteId);
    try {
      const res = await fetch('/api/hub/session-notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: noteId, is_visible_to_client: !currentValue }),
      });
      if (!res.ok) throw new Error('Failed to update visibility');

      setSessions((prev) =>
        prev.map((s) => ({
          ...s,
          notes: s.notes.map((n) =>
            n.id === noteId ? { ...n, is_visible_to_client: !currentValue } : n
          ),
        }))
      );
    } catch (err) {
      console.error('Failed to toggle visibility:', err);
    } finally {
      setTogglingVisibility(null);
    }
  }

  if (loading) {
    return <p className="font-mono text-sm text-black/40">Loading session notes...</p>;
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText className="w-12 h-12 text-black/15 mb-4" />
        <h3 className="font-mono font-bold uppercase text-sm tracking-wider mb-2">
          NO COMPLETED SESSIONS
        </h3>
        <p className="font-mono text-xs text-black/50 max-w-xs">
          Session notes will appear here after you complete a studio session. Book a session to get started.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-heading-md mb-6">SESSION NOTES</h2>

      <div className="space-y-4">
        {sessions.map((session) => {
          const engineerNotes = session.notes.filter((n) => n.author_type === 'engineer');
          const artistNotes = session.notes.filter((n) => n.author_type === 'artist');
          const hasNotes = session.notes.length > 0;
          const isFormOpen = expandedForm === session.id;
          const isSaved = saved === session.id;

          return (
            <div key={session.id} className="border-2 border-black/10 p-5">
              {/* Session header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Music className="w-4 h-4 text-accent" />
                  <div>
                    <p className="font-mono text-sm font-semibold">
                      {new Date(session.start_time).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </p>
                    <p className="font-mono text-[10px] text-black/40">
                      {session.room === 'studio_a' ? 'Studio A' : session.room === 'studio_b' ? 'Studio B' : session.room || 'Studio'}
                      {' · '}{formatDuration(session.duration)}
                      {session.engineer_name && ` · ${session.engineer_name}`}
                    </p>
                  </div>
                </div>

                {/* Save feedback */}
                {isSaved && (
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-accent animate-pulse">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>

              {/* Existing notes */}
              {hasNotes ? (
                <div className="space-y-3 mb-3">
                  {engineerNotes.map((note) => (
                    <div key={note.id} className="border-l-2 border-black/20 pl-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-mono text-[10px] font-bold uppercase text-black/40">
                          <MessageSquare className="w-3 h-3 inline mr-1" />
                          Engineer Notes
                        </p>
                        <div className="flex items-center gap-1">
                          {isEngineer ? (
                            <button
                              onClick={() => toggleVisibility(note.id, note.is_visible_to_client)}
                              disabled={togglingVisibility === note.id}
                              className="inline-flex items-center gap-1 font-mono text-[10px] text-black/40 hover:text-black transition-colors disabled:opacity-40"
                              title={note.is_visible_to_client ? 'Visible to client — click to hide' : 'Hidden from client — click to show'}
                            >
                              {note.is_visible_to_client ? (
                                <Eye className="w-3.5 h-3.5" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5 text-red-400" />
                              )}
                            </button>
                          ) : (
                            note.is_visible_to_client && (
                              <span title="Visible to you"><Eye className="w-3 h-3 text-black/20" /></span>
                            )
                          )}
                        </div>
                      </div>
                      <p className="font-mono text-xs text-black/70">{note.content}</p>
                      {note.what_was_worked_on && (
                        <p className="font-mono text-[10px] text-black/40 mt-1">
                          Worked on: {note.what_was_worked_on}
                        </p>
                      )}
                    </div>
                  ))}

                  {artistNotes.map((note) => (
                    <div key={note.id} className="border-l-2 border-accent pl-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-mono text-[10px] font-bold uppercase text-accent">
                          <FileText className="w-3 h-3 inline mr-1" />
                          Your Notes
                        </p>
                        {isEngineer && (
                          <button
                            onClick={() => toggleVisibility(note.id, note.is_visible_to_client)}
                            disabled={togglingVisibility === note.id}
                            className="inline-flex items-center gap-1 font-mono text-[10px] text-black/40 hover:text-black transition-colors disabled:opacity-40"
                            title={note.is_visible_to_client ? 'Visible to client — click to hide' : 'Hidden from client — click to show'}
                          >
                            {note.is_visible_to_client ? (
                              <Eye className="w-3.5 h-3.5" />
                            ) : (
                              <EyeOff className="w-3.5 h-3.5 text-red-400" />
                            )}
                          </button>
                        )}
                      </div>
                      <p className="font-mono text-xs text-black/70">{note.content}</p>
                      {note.what_was_worked_on && (
                        <p className="font-mono text-[10px] text-black/40 mt-1">
                          Worked on: {note.what_was_worked_on}
                        </p>
                      )}
                      {note.next_steps && (
                        <p className="font-mono text-[10px] text-black/40 mt-0.5">
                          Next steps: {note.next_steps}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="font-mono text-xs text-black/30 mb-3">
                  No notes yet — add your thoughts on this session.
                </p>
              )}

              {/* Add note form */}
              {isFormOpen ? (
                <div className="border-t border-black/10 pt-3 space-y-3">
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="What happened in this session?"
                    className="w-full border-2 border-black/10 px-3 py-2 font-mono text-xs bg-transparent focus:border-accent focus:outline-none transition-colors resize-none"
                    rows={3}
                  />
                  <input
                    type="text"
                    value={workedOn}
                    onChange={(e) => setWorkedOn(e.target.value)}
                    placeholder="What was worked on (e.g. vocals, mixing)"
                    className="w-full border-2 border-black/10 px-3 py-2 font-mono text-xs bg-transparent focus:border-accent focus:outline-none transition-colors"
                  />
                  <input
                    type="text"
                    value={nextSteps}
                    onChange={(e) => setNextSteps(e.target.value)}
                    placeholder="Next steps (optional)"
                    className="w-full border-2 border-black/10 px-3 py-2 font-mono text-xs bg-transparent focus:border-accent focus:outline-none transition-colors"
                  />
                  {projects.length > 0 && (
                    <select
                      value={linkedProject}
                      onChange={(e) => setLinkedProject(e.target.value)}
                      className="w-full border-2 border-black/10 px-3 py-2 font-mono text-xs bg-transparent focus:border-accent focus:outline-none transition-colors"
                    >
                      <option value="">Link to project (optional)</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  )}
                  {isEngineer && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleToClient}
                        onChange={(e) => setVisibleToClient(e.target.checked)}
                        className="w-3.5 h-3.5 accent-accent cursor-pointer"
                      />
                      <span className="font-mono text-xs text-black/60 flex items-center gap-1">
                        {visibleToClient ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                        Visible to client
                      </span>
                    </label>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleSave(session.id)}
                      disabled={!content.trim() || saving === session.id}
                      className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2 hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {saving === session.id ? 'Saving...' : 'Save Note'}
                    </button>
                    <button
                      onClick={resetForm}
                      className="font-mono text-xs text-black/40 hover:text-black transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    resetForm();
                    setExpandedForm(session.id);
                  }}
                  className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-black/40 hover:text-accent transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Note
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
