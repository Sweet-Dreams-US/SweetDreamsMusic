'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Pencil, Repeat } from 'lucide-react';
import { EVENT_TYPES } from '@/lib/hub-constants';
import { SkeletonCalendar } from './LoadingSkeleton';

interface CalendarEvent {
  id: string;
  title: string;
  event_type: string;
  event_date: string;
  event_time: string | null;
  description: string | null;
  color: string | null;
  is_auto_generated: boolean;
  source: string;
  recurring_rule?: string | null;
  recurring_end_date?: string | null;
}

type RecurringRule = '' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const RECURRING_OPTIONS: { value: RecurringRule; label: string }[] = [
  { value: '', label: 'No repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
];

export default function ContentCalendar({ onXpEarned }: { onXpEarned?: () => void }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  // Form fields
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState('other');
  const [formTime, setFormTime] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formRecurringRule, setFormRecurringRule] = useState<RecurringRule>('');
  const [formRecurringEndDate, setFormRecurringEndDate] = useState('');

  useEffect(() => { loadEvents(); }, [currentMonth]);

  async function loadEvents() {
    setLoading(true);
    const res = await fetch(`/api/hub/calendar?month=${currentMonth}`);
    const data = await res.json();
    setEvents(data.events || []);
    setLoading(false);
  }

  function resetForm() {
    setFormTitle('');
    setFormType('other');
    setFormTime('');
    setFormDescription('');
    setFormRecurringRule('');
    setFormRecurringEndDate('');
  }

  function openAddForm() {
    setEditingEvent(null);
    resetForm();
    setShowAddForm(true);
  }

  function openEditForm(event: CalendarEvent) {
    if (event.is_auto_generated) return;
    setShowAddForm(false);
    setEditingEvent(event);
    setFormTitle(event.title);
    setFormType(event.event_type);
    setFormTime(event.event_time || '');
    setFormDescription(event.description || '');
    setFormRecurringRule((event.recurring_rule as RecurringRule) || '');
    setFormRecurringEndDate(event.recurring_end_date || '');
  }

  function closeForm() {
    setShowAddForm(false);
    setEditingEvent(null);
    resetForm();
  }

  async function addEvent() {
    if (!formTitle.trim() || !selectedDate) return;
    const eventColor = EVENT_TYPES.find((t) => t.value === formType)?.color || '#6B7280';
    await fetch('/api/hub/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: formTitle,
        event_type: formType,
        event_date: selectedDate,
        event_time: formTime || null,
        description: formDescription || null,
        color: eventColor,
        recurring_rule: formRecurringRule || null,
        recurring_end_date: formRecurringEndDate || null,
      }),
    });

    // Award XP for adding a calendar event
    try {
      await fetch('/api/hub/xp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_calendar_event' }),
      });
      onXpEarned?.();
    } catch {}

    closeForm();
    await loadEvents();
  }

  async function updateEvent() {
    if (!editingEvent || !formTitle.trim()) return;
    const eventColor = EVENT_TYPES.find((t) => t.value === formType)?.color || '#6B7280';
    await fetch('/api/hub/calendar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingEvent.id,
        title: formTitle,
        event_type: formType,
        event_date: editingEvent.event_date,
        event_time: formTime || null,
        description: formDescription || null,
        color: eventColor,
        recurring_rule: formRecurringRule || null,
        recurring_end_date: formRecurringEndDate || null,
      }),
    });
    closeForm();
    await loadEvents();
  }

  async function deleteEvent(id: string) {
    await fetch('/api/hub/calendar', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (editingEvent?.id === id) closeForm();
    await loadEvents();
  }

  // Calendar grid computation
  const [year, month] = currentMonth.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date().toISOString().split('T')[0];

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach((e) => {
      const d = e.event_date;
      if (!map[d]) map[d] = [];
      map[d].push(e);
    });
    return map;
  }, [events]);

  function navigate(dir: -1 | 1) {
    const d = new Date(year, month - 1 + dir, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setSelectedDate(null);
    closeForm();
  }

  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] || []) : [];

  const isFormOpen = showAddForm || editingEvent !== null;

  // Shared form UI for add/edit
  function renderEventForm() {
    const isEditing = editingEvent !== null;
    return (
      <div className="border border-accent/30 p-3 mb-3 space-y-2 transition-all duration-200 ease-in-out">
        <input
          type="text"
          value={formTitle}
          onChange={(e) => setFormTitle(e.target.value)}
          className="w-full border border-black/20 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none transition-colors duration-150"
          placeholder="Event title..."
        />
        <textarea
          value={formDescription}
          onChange={(e) => setFormDescription(e.target.value)}
          className="w-full border border-black/20 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none resize-none transition-colors duration-150"
          placeholder="Description (optional)..."
          rows={2}
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={formType}
            onChange={(e) => setFormType(e.target.value)}
            className="border border-black/20 px-2 py-1.5 font-mono text-xs bg-white focus:border-accent focus:outline-none transition-colors duration-150"
          >
            {EVENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <input
            type="time"
            value={formTime}
            onChange={(e) => setFormTime(e.target.value)}
            className="border border-black/20 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none transition-colors duration-150"
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1.5">
            <Repeat className="w-3 h-3 text-black/40" />
            <select
              value={formRecurringRule}
              onChange={(e) => setFormRecurringRule(e.target.value as RecurringRule)}
              className="border border-black/20 px-2 py-1.5 font-mono text-xs bg-white focus:border-accent focus:outline-none transition-colors duration-150"
            >
              {RECURRING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {formRecurringRule && (
            <input
              type="date"
              value={formRecurringEndDate}
              onChange={(e) => setFormRecurringEndDate(e.target.value)}
              className="border border-black/20 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none transition-colors duration-150"
              placeholder="End date"
              title="Recurring end date (optional)"
            />
          )}
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={isEditing ? updateEvent : addEvent}
            disabled={!formTitle.trim()}
            className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 disabled:opacity-30 transition-opacity duration-150"
          >
            {isEditing ? 'Save' : 'Add'}
          </button>
          <button
            onClick={closeForm}
            className="font-mono text-xs text-black/40 uppercase tracking-wider px-4 py-2 hover:text-black/70 transition-colors duration-150"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-heading-md font-mono">CALENDAR</h2>
        </div>
        <SkeletonCalendar />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-heading-md font-mono">CALENDAR</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-2 border border-black/20 hover:border-accent transition-colors duration-150"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono text-sm font-bold uppercase tracking-wider min-w-[160px] text-center">
            {monthLabel}
          </span>
          <button
            onClick={() => navigate(1)}
            className="p-2 border border-black/20 hover:border-accent transition-colors duration-150"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="border-2 border-black/10">
        <div className="grid grid-cols-7 border-b border-black/10">
          {DAYS.map((d) => (
            <div key={d} className="p-2 text-center font-mono text-[10px] text-black/40 uppercase tracking-wider">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-black/5 bg-black/[0.02]" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayEvents = eventsByDate[dateStr] || [];
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;

            return (
              <button
                key={day}
                onClick={() => {
                  setSelectedDate(isSelected ? null : dateStr);
                  if (isSelected) closeForm();
                }}
                className={`min-h-[80px] border-b border-r border-black/5 p-1 text-left transition-all duration-150 ${
                  isSelected
                    ? 'bg-accent/10 ring-1 ring-accent/30'
                    : isToday
                      ? 'bg-accent/5'
                      : 'hover:bg-accent/[0.04] hover:shadow-inner'
                }`}
              >
                <span
                  className={`font-mono text-xs block mb-1 ${
                    isToday
                      ? 'bg-accent text-black w-6 h-6 flex items-center justify-center font-bold rounded-full'
                      : 'text-black/50'
                  }`}
                >
                  {day}
                </span>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((e) => (
                    <div key={e.id} className="flex items-center gap-1">
                      <div
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: e.color || '#6B7280' }}
                      />
                      <span className="font-mono text-[9px] text-black/50 truncate">{e.title}</span>
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="font-mono text-[9px] text-black/30">+{dayEvents.length - 3} more</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected date detail */}
      {selectedDate && (
        <div className="mt-4 border-2 border-black/10 p-4 transition-all duration-200 ease-in-out">
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-sm font-bold">
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </p>
            {!isFormOpen && (
              <button
                onClick={openAddForm}
                className="font-mono text-xs text-accent hover:underline inline-flex items-center gap-1 transition-colors duration-150"
              >
                <Plus className="w-3 h-3" /> Add Event
              </button>
            )}
          </div>

          {isFormOpen && renderEventForm()}

          {selectedEvents.length === 0 && !isFormOpen ? (
            <p className="font-mono text-xs text-black/30">No events this day</p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((e) => (
                <div
                  key={e.id}
                  className={`flex items-start gap-2 p-2 border border-black/5 transition-colors duration-150 ${
                    !e.is_auto_generated ? 'hover:border-accent/30 cursor-pointer' : ''
                  } ${editingEvent?.id === e.id ? 'border-accent/40 bg-accent/5' : ''}`}
                  onClick={() => {
                    if (!e.is_auto_generated) openEditForm(e);
                  }}
                >
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
                    style={{ backgroundColor: e.color || '#6B7280' }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs font-semibold truncate">{e.title}</p>
                    <p className="font-mono text-[10px] text-black/40">
                      {EVENT_TYPES.find((t) => t.value === e.event_type)?.label || e.event_type}
                      {e.event_time && ` \u00B7 ${e.event_time}`}
                      {e.is_auto_generated && ' \u00B7 auto'}
                      {e.recurring_rule && ` \u00B7 ${e.recurring_rule}`}
                    </p>
                    {e.description && (
                      <p className="font-mono text-[10px] text-black/30 mt-0.5 line-clamp-2">{e.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!e.is_auto_generated && (
                      <>
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            openEditForm(e);
                          }}
                          className="text-black/20 hover:text-accent p-1 transition-colors duration-150"
                          title="Edit event"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            deleteEvent(e.id);
                          }}
                          className="text-black/20 hover:text-red-500 p-1 transition-colors duration-150"
                          title="Delete event"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-3">
        {EVENT_TYPES.map((t) => (
          <span key={t.value} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
            <span className="font-mono text-[10px] text-black/40 uppercase tracking-wider">{t.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
