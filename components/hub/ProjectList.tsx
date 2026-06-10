'use client';

import { useState, useEffect } from 'react';
import NextLink from 'next/link';
import { Plus, Folder, ChevronRight, Check, X, Trash2, Edit3, Link, Music, Gauge, AlertTriangle, Info, Camera } from 'lucide-react';
import { PROJECT_PHASES, PROJECT_TYPES } from '@/lib/hub-constants';
import { ROLLOUT_ITEMS, RUSHED_RELEASE_DAYS } from '@/lib/career';
import { formatDuration } from '@/lib/utils';
import { fmtSessionDate } from '@/lib/studio-time';
import { SkeletonList } from './LoadingSkeleton';
import EmptyState from './EmptyState';

interface Task {
  id: string;
  phase: string;
  title: string;
  is_completed: boolean;
  display_order: number;
}

interface Project {
  id: string;
  title: string;
  project_type: string;
  description: string | null;
  genre: string | null;
  target_release_date: string | null;
  current_phase: string;
  status: string;
  created_at: string;
  artist_project_tasks: Task[];
  rollout_score?: number | null;
  rollout_breakdown?: Record<string, boolean | number> | null; // item keys → met; extra date_ahead_days (number) ignored
  presave_url?: string | null;
  video_url?: string | null;
  ad_budget_cents?: number | null;
  released_at?: string | null;
  slug?: string | null;
}

interface LinkedSession {
  id: string;
  start_time: string;
  duration: number;
  room: string | null;
  engineer_name: string | null;
  status: string;
}

export default function ProjectList({ onXpEarned }: { onXpEarned?: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'completed' | 'all'>('active');
  const [title, setTitle] = useState('');
  const [projectType, setProjectType] = useState('single');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [linkedSessions, setLinkedSessions] = useState<Record<string, LinkedSession[]>>({});

  // Rollout detail inputs (seeded for the expanded project)
  const [rolloutPresave, setRolloutPresave] = useState('');
  const [rolloutVideo, setRolloutVideo] = useState('');
  const [rolloutAdBudget, setRolloutAdBudget] = useState(''); // dollars; ×100 on save
  const [savingRollout, setSavingRollout] = useState(false);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editType, setEditType] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editGenre, setEditGenre] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    const res = await fetch('/api/hub/projects');
    const data = await res.json();
    setProjects(data.projects || []);
    setLoading(false);
  }

  async function awardXp(action: string) {
    try {
      await fetch('/api/hub/xp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      onXpEarned?.();
    } catch { /* silent */ }
  }

  async function createProject() {
    if (!title.trim()) return;
    setCreating(true);
    const res = await fetch('/api/hub/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, project_type: projectType, description, genre, target_release_date: targetDate || null }),
    });
    if (res.ok) {
      setTitle(''); setProjectType('single'); setDescription(''); setGenre(''); setTargetDate('');
      setShowForm(false);
      await loadProjects();
      awardXp('create_project');
    }
    setCreating(false);
  }

  async function updateProject(projectId: string) {
    await fetch('/api/hub/projects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        title: editTitle,
        project_type: editType,
        description: editDescription || null,
        genre: editGenre || null,
        target_release_date: editTargetDate || null,
      }),
    });
    setEditingId(null);
    await loadProjects();
  }

  function startEditing(project: Project) {
    setEditingId(project.id);
    setEditTitle(project.title);
    setEditType(project.project_type);
    setEditDescription(project.description || '');
    setEditGenre(project.genre || '');
    setEditTargetDate(project.target_release_date || '');
  }

  async function toggleTask(taskId: string, currentValue: boolean) {
    await fetch('/api/hub/projects/tasks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: taskId, is_completed: !currentValue }),
    });
    if (!currentValue) awardXp('complete_task'); // only award for completing, not uncompleting
    await loadProjects();
  }

  async function addTask(projectId: string, phase: string) {
    if (!newTaskText.trim()) return;
    await fetch('/api/hub/projects/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, phase, title: newTaskText }),
    });
    setNewTaskText('');
    await loadProjects();
  }

  async function advancePhase(projectId: string, currentPhase: string) {
    const phaseIdx = PROJECT_PHASES.findIndex((p) => p.key === currentPhase);
    if (phaseIdx < 0 || phaseIdx >= PROJECT_PHASES.length - 1) return;
    const nextPhase = PROJECT_PHASES[phaseIdx + 1].key;
    const isComplete = nextPhase === 'released';

    await fetch('/api/hub/projects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, current_phase: nextPhase, status: isComplete ? 'completed' : 'active' }),
    });
    awardXp('advance_phase');
    if (isComplete) awardXp('complete_project');
    await loadProjects();
  }

  async function deleteProject(projectId: string) {
    if (!confirm('Delete this project and all its tasks?')) return;
    await fetch('/api/hub/projects', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: projectId }) });
    await loadProjects();
  }

  // Load linked sessions for a project when expanded
  async function loadLinkedSessions(projectId: string) {
    try {
      const res = await fetch(`/api/hub/session-notes?project_id=${projectId}&sessions_only=1`);
      const data = await res.json();
      setLinkedSessions((prev) => ({ ...prev, [projectId]: data.sessions || [] }));
    } catch { /* silent */ }
  }

  function handleExpand(projectId: string) {
    const isExpanding = expandedId !== projectId;
    setExpandedId(isExpanding ? projectId : null);
    setEditingId(null);
    if (isExpanding) {
      loadLinkedSessions(projectId);
      const p = projects.find((pr) => pr.id === projectId);
      setRolloutPresave(p?.presave_url || '');
      setRolloutVideo(p?.video_url || '');
      setRolloutAdBudget(p?.ad_budget_cents != null ? String(p.ad_budget_cents / 100) : '');
    }
  }

  async function saveRolloutDetails(projectId: string) {
    setSavingRollout(true);
    const dollars = parseFloat(rolloutAdBudget);
    await fetch('/api/hub/projects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        presave_url: rolloutPresave.trim() || null,
        video_url: rolloutVideo.trim() || null,
        ad_budget_cents: !isNaN(dollars) && dollars > 0 ? Math.round(dollars * 100) : null,
      }),
    });
    await loadProjects(); // server recomputes the rollout score
    setSavingRollout(false);
  }

  const filtered = projects.filter((p) => filter === 'all' ? true : p.status === filter);

  function getPhaseIndex(phase: string) { return PROJECT_PHASES.findIndex((p) => p.key === phase); }
  function daysUntil(date: string) { return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000); }

  if (loading) return <SkeletonList count={3} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-heading-md">PROJECTS</h2>
        <button onClick={() => setShowForm(!showForm)}
          className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent/90 transition-colors inline-flex items-center gap-1">
          {showForm ? <><X className="w-3 h-3" /> Cancel</> : <><Plus className="w-3 h-3" /> New Project</>}
        </button>
      </div>

      <div className="flex gap-0 border-b border-black/10 mb-6">
        {(['active', 'completed', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`font-mono text-xs uppercase tracking-wider px-4 py-3 border-b-2 transition-colors ${
              filter === f ? 'border-accent text-black font-bold' : 'border-transparent text-black/40'
            }`}>
            {f} ({projects.filter((p) => f === 'all' ? true : p.status === f).length})
          </button>
        ))}
      </div>

      {showForm && (
        <div className="border-2 border-accent p-6 mb-8 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <h3 className="font-mono text-sm font-bold uppercase">New Project</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Title *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none transition-colors" placeholder="Project title" />
            </div>
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Type</label>
              <select value={projectType} onChange={(e) => setProjectType(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white">
                {PROJECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Genre</label>
              <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none transition-colors" placeholder="Hip-Hop, R&B, etc." />
            </div>
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Target Release Date</label>
              <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none resize-none" />
          </div>
          <button onClick={createProject} disabled={!title.trim() || creating}
            className="bg-black text-white font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-black/80 disabled:opacity-50 transition-colors">
            {creating ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Folder}
          title={filter === 'active' ? 'No Active Projects' : 'No Projects Found'}
          description={filter === 'active' ? 'Start tracking your next release from concept to drop.' : 'Create your first project to get started.'}
          action={{ label: 'New Project', onClick: () => setShowForm(true) }}
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((project) => {
            const isExpanded = expandedId === project.id;
            const isEditing = editingId === project.id;
            const phaseIdx = getPhaseIndex(project.current_phase);
            const phaseTasks = project.artist_project_tasks?.filter((t) => t.phase === project.current_phase) || [];
            const completedTasks = phaseTasks.filter((t) => t.is_completed).length;
            const allTasks = project.artist_project_tasks || [];
            const allCompleted = allTasks.filter((t) => t.is_completed).length;
            const days = project.target_release_date ? daysUntil(project.target_release_date) : null;
            const typeLabel = PROJECT_TYPES.find((t) => t.value === project.project_type)?.label || project.project_type;
            const sessions = linkedSessions[project.id] || [];

            return (
              <div key={project.id} className="border-2 border-black/10 transition-all duration-200 hover:border-black/20">
                <button onClick={() => handleExpand(project.id)}
                  className="w-full p-4 sm:p-5 flex items-center gap-4 text-left hover:bg-black/[0.02] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-mono text-sm font-bold">{project.title}</p>
                      <span className="font-mono text-[10px] text-black/40 border border-black/10 px-1.5 py-0.5 uppercase">{typeLabel}</span>
                      {project.genre && <span className="font-mono text-[10px] text-accent/60">{project.genre}</span>}
                    </div>
                    {/* Phase progress bar with animation */}
                    <div className="flex gap-0.5 mt-2">
                      {PROJECT_PHASES.map((phase, idx) => (
                        <div key={phase.key}
                          className={`h-1.5 flex-1 transition-all duration-500 ${idx <= phaseIdx ? 'bg-accent' : 'bg-black/10'} ${idx === 0 ? 'rounded-l-full' : ''} ${idx === PROJECT_PHASES.length - 1 ? 'rounded-r-full' : ''}`}
                        />
                      ))}
                    </div>
                    <p className="font-mono text-[10px] text-black/40 mt-1">
                      {PROJECT_PHASES[phaseIdx]?.label} · {completedTasks}/{phaseTasks.length} tasks · {allCompleted}/{allTasks.length} total
                      {days !== null && <span className={days < 0 ? ' text-red-500' : days < 14 ? ' text-amber-600' : ''}> · {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d until release`}</span>}
                    </p>
                  </div>
                  <ChevronRight className={`w-5 h-5 text-black/20 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                </button>

                {isExpanded && (
                  <div className="border-t border-black/10 p-4 sm:p-5 space-y-4">
                    {/* Edit form */}
                    {isEditing ? (
                      <div className="border border-accent/30 p-4 space-y-3 bg-accent/5">
                        <p className="font-mono text-xs font-bold uppercase tracking-wider">Edit Project</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                            className="border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" placeholder="Title" />
                          <select value={editType} onChange={(e) => setEditType(e.target.value)}
                            className="border border-black/20 px-3 py-2 font-mono text-sm bg-white focus:border-accent focus:outline-none">
                            {PROJECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                          <input type="text" value={editGenre} onChange={(e) => setEditGenre(e.target.value)}
                            className="border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" placeholder="Genre" />
                          <input type="date" value={editTargetDate} onChange={(e) => setEditTargetDate(e.target.value)}
                            className="border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" />
                        </div>
                        <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={2}
                          className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none resize-none" placeholder="Description" />
                        <div className="flex gap-2">
                          <button onClick={() => updateProject(project.id)}
                            className="font-mono text-xs font-bold bg-accent text-black px-4 py-2 hover:bg-accent/90 transition-colors">Save</button>
                          <button onClick={() => setEditingId(null)}
                            className="font-mono text-xs text-black/40 hover:text-black px-3 py-2">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {project.description && <p className="font-mono text-xs text-black/60">{project.description}</p>}

                        {/* Phase chips */}
                        <div>
                          <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-2">Phase</p>
                          <div className="flex flex-wrap gap-1">
                            {PROJECT_PHASES.map((phase, idx) => (
                              <span key={phase.key} className={`font-mono text-[10px] px-2 py-1 transition-all duration-300 ${
                                idx === phaseIdx ? 'bg-accent text-black font-bold' : idx < phaseIdx ? 'bg-black/5 text-black/50' : 'bg-black/[0.02] text-black/20'
                              }`}>{phase.label}</span>
                            ))}
                          </div>
                        </div>

                        {/* Current phase tasks */}
                        <div>
                          <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-2">{PROJECT_PHASES[phaseIdx]?.label} Tasks</p>
                          <div className="space-y-1">
                            {phaseTasks.sort((a, b) => a.display_order - b.display_order).map((task) => (
                              <button key={task.id} onClick={() => toggleTask(task.id, task.is_completed)}
                                className="w-full flex items-center gap-2 p-2 hover:bg-black/[0.02] transition-colors text-left group">
                                <div className={`w-4 h-4 border flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                                  task.is_completed ? 'bg-accent border-accent' : 'border-black/20 group-hover:border-accent'
                                }`}>{task.is_completed && <Check className="w-3 h-3 text-black" />}</div>
                                <span className={`font-mono text-xs transition-all duration-200 ${task.is_completed ? 'line-through text-black/30' : 'text-black/70'}`}>{task.title}</span>
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-2 mt-2">
                            <input type="text" value={newTaskText} onChange={(e) => setNewTaskText(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && addTask(project.id, project.current_phase)}
                              className="flex-1 border border-black/10 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none transition-colors" placeholder="Add a task..." />
                            <button onClick={() => addTask(project.id, project.current_phase)} disabled={!newTaskText.trim()}
                              className="font-mono text-xs text-accent hover:text-accent/80 disabled:opacity-30 px-2 transition-colors"><Plus className="w-3 h-3" /></button>
                          </div>
                        </div>

                        {/* Linked sessions */}
                        {sessions.length > 0 && (
                          <div>
                            <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-2 inline-flex items-center gap-1">
                              <Link className="w-3 h-3" /> Linked Sessions
                            </p>
                            <div className="space-y-1">
                              {sessions.map((s) => (
                                <div key={s.id} className="flex items-center gap-2 p-2 bg-black/[0.02] border border-black/5">
                                  <Music className="w-3 h-3 text-black/30" />
                                  <span className="font-mono text-xs text-black/60">
                                    {fmtSessionDate(s.start_time, { month: 'short', day: 'numeric' })}
                                    {' · '}{formatDuration(s.duration)}
                                    {s.room && ` · ${s.room === 'studio_a' ? 'A' : 'B'}`}
                                    {s.engineer_name && ` · ${s.engineer_name}`}
                                  </span>
                                  <span className={`ml-auto font-mono text-[10px] uppercase font-bold ${
                                    s.status === 'completed' ? 'text-green-600' : 'text-accent'
                                  }`}>{s.status}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Rollout score */}
                        {project.status === 'active' && (() => {
                          const score = project.rollout_score ?? 0;
                          const scoreColor = score < 40 ? 'text-red-500' : score < 70 ? 'text-amber-600' : 'text-green-600';
                          const breakdown = project.rollout_breakdown || {};
                          const isRushed = days !== null && days < RUSHED_RELEASE_DAYS;
                          const isMultiTrack = project.project_type === 'album' || project.project_type === 'ep';
                          return (
                            <div className="border-t border-black/10 pt-4">
                              <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-2 inline-flex items-center gap-1">
                                <Gauge className="w-3 h-3" /> Rollout Score
                              </p>
                              <div className="flex items-baseline gap-1 mb-3">
                                <span className={`font-mono text-3xl font-bold ${scoreColor}`}>{score}</span>
                                <span className="font-mono text-xs text-black/30">/100</span>
                              </div>

                              {isMultiTrack && (
                                <div className="flex items-start gap-2 border border-black/10 bg-black/[0.02] p-3 mb-3">
                                  <Info className="w-3.5 h-3.5 text-black/40 flex-shrink-0 mt-0.5" />
                                  <p className="font-mono text-xs text-black/60">Singles build followings — albums reward them. Consider 3-4 singles first.</p>
                                </div>
                              )}

                              {isRushed && (
                                <div className="flex items-start gap-2 border border-amber-300 bg-amber-50 p-3 mb-3">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                                  <p className="font-mono text-xs text-amber-700">Rushed release: under 2 weeks of runway. The Playbook&apos;s Release Strategy explains why 21+ days wins.</p>
                                </div>
                              )}

                              {/* Checklist */}
                              <div className="space-y-1 mb-4">
                                {ROLLOUT_ITEMS.map((item) => {
                                  const met = breakdown[item.key] === true;
                                  return (
                                    <div key={item.key} className="flex items-center gap-2 py-1">
                                      <div className={`w-4 h-4 border flex items-center justify-center flex-shrink-0 ${
                                        met ? 'bg-accent border-accent' : 'border-black/20'
                                      }`}>{met && <Check className="w-3 h-3 text-black" />}</div>
                                      <span className={`font-mono text-xs ${met ? 'text-black/70' : 'text-black/40'}`}>{item.label}</span>
                                      <span className="font-mono text-[10px] text-black/30 ml-auto flex-shrink-0">+{item.weight}</span>
                                      {!met && (item.key === 'photoshoot' || item.key === 'video') && (
                                        <NextLink href="/media"
                                          className="font-mono text-[10px] text-accent hover:underline flex-shrink-0 inline-flex items-center gap-1">
                                          <Camera className="w-3 h-3" /> Book a {item.key === 'photoshoot' ? 'photoshoot' : 'video'}
                                        </NextLink>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Inline rollout details */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                  <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Pre-save Link</label>
                                  <input type="url" value={rolloutPresave} onChange={(e) => setRolloutPresave(e.target.value)}
                                    className="w-full border border-black/20 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none transition-colors" placeholder="https://..." />
                                </div>
                                <div>
                                  <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Video Link</label>
                                  <input type="url" value={rolloutVideo} onChange={(e) => setRolloutVideo(e.target.value)}
                                    className="w-full border border-black/20 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none transition-colors" placeholder="https://..." />
                                </div>
                                <div>
                                  <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Ad Budget ($)</label>
                                  <input type="number" min="0" step="1" value={rolloutAdBudget} onChange={(e) => setRolloutAdBudget(e.target.value)}
                                    className="w-full border border-black/20 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none transition-colors" placeholder="0" />
                                </div>
                              </div>
                              <button onClick={() => saveRolloutDetails(project.id)} disabled={savingRollout}
                                className="mt-3 font-mono text-xs font-bold uppercase tracking-wider bg-accent text-black px-4 py-2 hover:bg-accent/90 disabled:opacity-50 transition-colors">
                                {savingRollout ? 'Saving...' : 'Save Rollout Details'}
                              </button>
                            </div>
                          );
                        })()}
                      </>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-black/10">
                      {phaseIdx < PROJECT_PHASES.length - 1 && !isEditing && (
                        <button onClick={() => advancePhase(project.id, project.current_phase)}
                          className="font-mono text-xs font-bold uppercase tracking-wider bg-accent text-black px-4 py-2 hover:bg-accent/90 transition-colors inline-flex items-center gap-1">
                          <ChevronRight className="w-3 h-3" /> Advance to {PROJECT_PHASES[phaseIdx + 1]?.label}
                        </button>
                      )}
                      {!isEditing && (
                        <button onClick={() => startEditing(project)}
                          className="font-mono text-xs uppercase tracking-wider border border-black/20 text-black/60 px-3 py-2 hover:bg-black/5 transition-colors inline-flex items-center gap-1">
                          <Edit3 className="w-3 h-3" /> Edit
                        </button>
                      )}
                      <button onClick={() => deleteProject(project.id)}
                        className="font-mono text-xs uppercase tracking-wider border border-red-300 text-red-500 px-3 py-2 hover:bg-red-50 transition-colors inline-flex items-center gap-1">
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
