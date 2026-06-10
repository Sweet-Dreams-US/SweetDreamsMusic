'use client';

import { useState, useEffect } from 'react';
import { Plus, Target, X, Check, Trash2, Edit3, TrendingUp } from 'lucide-react';
import { GOAL_CATEGORIES, METRIC_PLATFORMS } from '@/lib/hub-constants';
import { fmtStampDate } from '@/lib/studio-time';
import { SkeletonList } from './LoadingSkeleton';
import EmptyState from './EmptyState';

interface Goal {
  id: string;
  title: string;
  description: string | null;
  category: string;
  target_value: number | null;
  current_value: number;
  target_date: string | null;
  status: string;
  completed_at: string | null;
  linked_platform?: string | null;
}

export default function GoalTracker({ onXpEarned }: { onXpEarned?: () => void }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('other');
  const [linkedPlatform, setLinkedPlatform] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingProgress, setEditingProgress] = useState<string | null>(null);
  const [progressInput, setProgressInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editLinkedPlatform, setEditLinkedPlatform] = useState('');
  const [editTargetValue, setEditTargetValue] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [filter, setFilter] = useState<'active' | 'completed' | 'all'>('active');

  useEffect(() => { loadGoals(); }, []);

  async function loadGoals() {
    const res = await fetch('/api/hub/goals');
    const data = await res.json();
    setGoals(data.goals || []);
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

  async function createGoal() {
    if (!title.trim()) return;
    setCreating(true);
    await fetch('/api/hub/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, description, category,
        target_value: targetValue ? parseFloat(targetValue) : null,
        target_date: targetDate || null,
        linked_platform: (category === 'streaming' || category === 'social') && linkedPlatform ? linkedPlatform : null,
      }),
    });
    setTitle(''); setDescription(''); setCategory('other'); setLinkedPlatform(''); setTargetValue(''); setTargetDate('');
    setShowForm(false);
    await loadGoals();
    awardXp('set_goal');
    setCreating(false);
  }

  async function updateProgress(goalId: string) {
    const val = parseFloat(progressInput);
    if (isNaN(val)) return;

    const goal = goals.find((g) => g.id === goalId);
    const wasActive = goal?.status === 'active';

    await fetch('/api/hub/goals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: goalId, current_value: val }),
    });
    setEditingProgress(null);
    setProgressInput('');
    awardXp('update_goal');
    await loadGoals();

    // Check if this completed the goal
    if (wasActive && goal?.target_value && val >= goal.target_value) {
      awardXp('complete_goal');
    }
  }

  async function updateGoal(goalId: string) {
    await fetch('/api/hub/goals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: goalId,
        title: editTitle,
        description: editDescription || null,
        category: editCategory,
        target_value: editTargetValue ? parseFloat(editTargetValue) : null,
        target_date: editTargetDate || null,
        linked_platform: (editCategory === 'streaming' || editCategory === 'social') && editLinkedPlatform ? editLinkedPlatform : null,
      }),
    });
    setEditingId(null);
    await loadGoals();
  }

  function startEditing(goal: Goal) {
    setEditingId(goal.id);
    setEditTitle(goal.title);
    setEditDescription(goal.description || '');
    setEditCategory(goal.category);
    setEditLinkedPlatform(goal.linked_platform || '');
    setEditTargetValue(goal.target_value ? String(goal.target_value) : '');
    setEditTargetDate(goal.target_date || '');
  }

  async function deleteGoal(id: string) {
    if (!confirm('Delete this goal?')) return;
    await fetch('/api/hub/goals', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    await loadGoals();
  }

  const filtered = goals.filter((g) => filter === 'all' ? true : g.status === filter);

  if (loading) return <SkeletonList count={3} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-heading-md">GOALS</h2>
        <button onClick={() => setShowForm(!showForm)}
          className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent/90 transition-colors inline-flex items-center gap-1">
          {showForm ? <><X className="w-3 h-3" /> Cancel</> : <><Plus className="w-3 h-3" /> New Goal</>}
        </button>
      </div>

      <div className="flex gap-0 border-b border-black/10 mb-6">
        {(['active', 'completed', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`font-mono text-xs uppercase tracking-wider px-4 py-3 border-b-2 transition-colors ${
              filter === f ? 'border-accent text-black font-bold' : 'border-transparent text-black/40'
            }`}>{f} ({goals.filter((g) => f === 'all' ? true : g.status === f).length})</button>
        ))}
      </div>

      {showForm && (
        <div className="border-2 border-accent p-6 mb-8 space-y-4">
          <h3 className="font-mono text-sm font-bold uppercase">New Goal</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Goal *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" placeholder="Hit 1,000 Spotify monthly listeners" />
            </div>
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white">
                {GOAL_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            {(category === 'streaming' || category === 'social') && (
              <div>
                <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Linked Platform</label>
                <select value={linkedPlatform} onChange={(e) => setLinkedPlatform(e.target.value)}
                  className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white">
                  <option value="">None (manual updates)</option>
                  {METRIC_PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Target Number</label>
              <input type="number" value={targetValue} onChange={(e) => setTargetValue(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" placeholder="1000" />
            </div>
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Target Date</label>
              <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none resize-none" />
          </div>
          <button onClick={createGoal} disabled={!title.trim() || creating}
            className="bg-black text-white font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-black/80 disabled:opacity-50 transition-colors">
            {creating ? 'Creating...' : 'Set Goal'}
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No Goals Yet"
          description="Set career milestones and track your progress. Start with something achievable."
          action={{ label: 'Set a Goal', onClick: () => setShowForm(true) }}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((goal) => {
            const pct = goal.target_value ? Math.min(100, Math.round((goal.current_value / goal.target_value) * 100)) : 0;
            const catLabel = GOAL_CATEGORIES.find((c) => c.value === goal.category)?.label || goal.category;
            const isComplete = goal.status === 'completed';
            const isEditing = editingId === goal.id;
            const daysLeft = goal.target_date ? Math.ceil((new Date(goal.target_date).getTime() - Date.now()) / 86400000) : null;

            return (
              <div key={goal.id} className={`border-2 p-4 transition-all duration-300 ${
                isComplete ? 'border-green-200 bg-green-50/30' : 'border-black/10 hover:border-black/20'
              }`}>
                {isEditing ? (
                  <div className="space-y-3">
                    <p className="font-mono text-xs font-bold uppercase tracking-wider">Edit Goal</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                        className="border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" />
                      <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}
                        className="border border-black/20 px-3 py-2 font-mono text-sm bg-white focus:border-accent focus:outline-none">
                        {GOAL_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                      {(editCategory === 'streaming' || editCategory === 'social') && (
                        <select value={editLinkedPlatform} onChange={(e) => setEditLinkedPlatform(e.target.value)}
                          className="border border-black/20 px-3 py-2 font-mono text-sm bg-white focus:border-accent focus:outline-none">
                          <option value="">No linked platform</option>
                          {METRIC_PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                        </select>
                      )}
                      <input type="number" value={editTargetValue} onChange={(e) => setEditTargetValue(e.target.value)}
                        className="border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" placeholder="Target" />
                      <input type="date" value={editTargetDate} onChange={(e) => setEditTargetDate(e.target.value)}
                        className="border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" />
                    </div>
                    <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={2}
                      className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none resize-none" placeholder="Description" />
                    <div className="flex gap-2">
                      <button onClick={() => updateGoal(goal.id)}
                        className="font-mono text-xs font-bold bg-accent text-black px-4 py-2 hover:bg-accent/90 transition-colors">Save</button>
                      <button onClick={() => setEditingId(null)}
                        className="font-mono text-xs text-black/40 hover:text-black px-3 py-2">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isComplete && <Check className="w-4 h-4 text-green-600" />}
                          <p className="font-mono text-sm font-bold">{goal.title}</p>
                          <span className="font-mono text-[10px] text-black/40 border border-black/10 px-1.5 py-0.5 uppercase">{catLabel}</span>
                          {daysLeft !== null && !isComplete && (
                            <span className={`font-mono text-[10px] ${daysLeft < 0 ? 'text-red-500' : daysLeft < 7 ? 'text-amber-600' : 'text-black/30'}`}>
                              {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                            </span>
                          )}
                        </div>
                        {goal.description && <p className="font-mono text-xs text-black/50 mt-1">{goal.description}</p>}

                        {goal.target_value != null && (
                          <div className="mt-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-mono text-[10px] text-black/40 inline-flex items-center gap-2">
                                {goal.current_value.toLocaleString()} / {goal.target_value.toLocaleString()}
                                {goal.linked_platform && (
                                  <span className="bg-accent text-black font-bold px-1.5 py-0.5 uppercase tracking-wider"
                                    title={METRIC_PLATFORMS.find((p) => p.key === goal.linked_platform)?.label}>
                                    auto-syncs weekly
                                  </span>
                                )}
                              </span>
                              <span className="font-mono text-[10px] font-bold text-accent">{pct}%</span>
                            </div>
                            <div className="h-2 bg-black/10 rounded-full overflow-hidden">
                              <div className="h-full bg-accent rounded-full transition-all duration-700 ease-out"
                                style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {!isComplete && (
                          <>
                            <button onClick={() => { setEditingProgress(editingProgress === goal.id ? null : goal.id); setProgressInput(String(goal.current_value)); }}
                              className="font-mono text-[10px] text-accent hover:underline px-2 py-1 inline-flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" /> Update
                            </button>
                            <button onClick={() => startEditing(goal)}
                              className="text-black/20 hover:text-black/60 p-1 transition-colors"><Edit3 className="w-3 h-3" /></button>
                          </>
                        )}
                        <button onClick={() => deleteGoal(goal.id)} className="text-red-300 hover:text-red-500 p-1 transition-colors"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>

                    {editingProgress === goal.id && (
                      <div className="flex gap-2 mt-3 pt-3 border-t border-black/10">
                        <input type="number" value={progressInput} onChange={(e) => setProgressInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && updateProgress(goal.id)}
                          className="w-32 border border-black/20 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none" />
                        <button onClick={() => updateProgress(goal.id)}
                          className="font-mono text-xs font-bold bg-accent text-black px-3 py-1.5 hover:bg-accent/90 transition-colors">Save</button>
                      </div>
                    )}

                    {isComplete && goal.completed_at && (
                      <p className="font-mono text-[10px] text-green-600 mt-2 pt-2 border-t border-green-100">
                        Completed {fmtStampDate(goal.completed_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
