'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, DollarSign, Video, Pencil, X, Check, Search, UserPlus } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { ENGINEERS } from '@/lib/constants';
import { fmtStampDate } from '@/lib/studio-time';

interface MediaSale {
  id: string;
  description: string;
  amount: number;
  sale_type: string;
  sold_by: string | null;
  filmed_by: string | null;
  edited_by: string | null;
  client_name: string | null;
  client_email: string | null;
  notes: string | null;
  created_at: string;
}

const SALE_TYPES = [
  { value: 'video', label: 'Music Video' },
  { value: 'photo', label: 'Photo Shoot' },
  { value: 'content', label: 'Content Creation' },
  { value: 'other', label: 'Other' },
];

const ENGINEER_NAMES = ENGINEERS.map(e => e.name);

const MEDIA_COMMISSION = 0.15;

export default function MediaSales() {
  const [sales, setSales] = useState<MediaSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [saleType, setSaleType] = useState('video');
  const [soldBy, setSoldBy] = useState('');
  const [filmedBy, setFilmedBy] = useState('');
  const [editedBy, setEditedBy] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [notes, setNotes] = useState('');

  // Client picker
  const [clients, setClients] = useState<{ id: string; display_name: string; email: string | null }[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [manualClientEntry, setManualClientEntry] = useState(false);
  const clientPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSales();
    fetch('/api/admin/library/clients').then(r => r.json()).then(d => setClients(d.clients || [])).catch(() => {});
  }, []);

  // Close client picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (clientPickerRef.current && !clientPickerRef.current.contains(e.target as Node)) setShowClientPicker(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients.slice(0, 8);
    const q = clientSearch.toLowerCase();
    return clients.filter(c => c.display_name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)).slice(0, 8);
  }, [clients, clientSearch]);

  async function fetchSales() {
    setLoading(true);
    const res = await fetch('/api/admin/media-sales');
    const data = await res.json();
    setSales(data.sales || []);
    setLoading(false);
  }

  function resetForm() {
    setDescription(''); setAmount(''); setSaleType('video'); setSoldBy(''); setFilmedBy(''); setEditedBy('');
    setClientName(''); setClientEmail(''); setNotes('');
    setEditingId(null); setManualClientEntry(false); setClientSearch(''); setShowClientPicker(false);
  }

  function startEdit(sale: MediaSale) {
    setEditingId(sale.id);
    setDescription(sale.description);
    setAmount((sale.amount / 100).toFixed(2));
    setSaleType(sale.sale_type || 'video');
    setSoldBy(sale.sold_by || '');
    setFilmedBy(sale.filmed_by || '');
    setEditedBy(sale.edited_by || '');
    setClientName(sale.client_name || '');
    setClientEmail(sale.client_email || '');
    setNotes(sale.notes || '');
    setShowForm(true);
  }

  async function handleSave() {
    if (!description || !amount) { alert('Description and amount required'); return; }
    setSaving(true);

    const body = { description, amount: parseFloat(amount), saleType, soldBy, filmedBy, editedBy, clientName, clientEmail, notes };

    const res = editingId
      ? await fetch('/api/admin/media-sales', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, ...body }),
        })
      : await fetch('/api/admin/media-sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

    if (res.ok) {
      resetForm();
      setShowForm(false);
      fetchSales();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to save');
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this media sale record?')) return;
    await fetch('/api/admin/media-sales', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchSales();
  }

  // Stats
  const totalRevenue = useMemo(() => sales.reduce((s, m) => s + m.amount, 0), [sales]);

  const bySeller = useMemo(() => {
    const map: Record<string, { count: number; revenue: number; commission: number }> = {};
    sales.forEach(s => {
      const name = s.sold_by || 'Unassigned';
      if (!map[name]) map[name] = { count: 0, revenue: 0, commission: 0 };
      map[name].count++;
      map[name].revenue += s.amount;
      map[name].commission += Math.round(s.amount * MEDIA_COMMISSION);
    });
    return Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue);
  }, [sales]);

  const byType = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    sales.forEach(s => {
      const type = s.sale_type || 'other';
      if (!map[type]) map[type] = { count: 0, revenue: 0 };
      map[type].count++;
      map[type].revenue += s.amount;
    });
    return Object.entries(map);
  }, [sales]);

  // Per-person payout tracking
  const personPayouts = useMemo(() => {
    const map: Record<string, { soldCount: number; soldRevenue: number; soldCommission: number; filmedCount: number; editedCount: number }> = {};
    sales.forEach(s => {
      if (s.sold_by) {
        if (!map[s.sold_by]) map[s.sold_by] = { soldCount: 0, soldRevenue: 0, soldCommission: 0, filmedCount: 0, editedCount: 0 };
        map[s.sold_by].soldCount++;
        map[s.sold_by].soldRevenue += s.amount;
        map[s.sold_by].soldCommission += Math.round(s.amount * MEDIA_COMMISSION);
      }
      if (s.filmed_by) {
        if (!map[s.filmed_by]) map[s.filmed_by] = { soldCount: 0, soldRevenue: 0, soldCommission: 0, filmedCount: 0, editedCount: 0 };
        map[s.filmed_by].filmedCount++;
      }
      if (s.edited_by) {
        if (!map[s.edited_by]) map[s.edited_by] = { soldCount: 0, soldRevenue: 0, soldCommission: 0, filmedCount: 0, editedCount: 0 };
        map[s.edited_by].editedCount++;
      }
    });
    return Object.entries(map).sort((a, b) => b[1].soldCommission - a[1].soldCommission);
  }, [sales]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-heading-sm">MEDIA SALES</h2>
          <p className="font-mono text-xs text-black/40 mt-1">Track video, photo, and content sales. 15% commission to the seller.</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="inline-flex items-center gap-2 bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-black/80 transition-colors"
        >
          <Plus className="w-3 h-3" /> Log Sale
        </button>
      </div>

      {/* New/Edit Sale Form */}
      {showForm && (
        <div className="border-2 border-accent p-6 space-y-4">
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider">
            {editingId ? 'Edit Media Sale' : 'Log New Media Sale'}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Description *</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                placeholder="e.g. Music video for Artist Name" />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Amount ($) *</label>
              <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                placeholder="500.00" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Type</label>
              <select value={saleType} onChange={(e) => setSaleType(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none">
                {SALE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Sold By (gets 15% commission)</label>
              <select value={soldBy} onChange={(e) => setSoldBy(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none">
                <option value="">Select...</option>
                {ENGINEER_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Filmed By</label>
              <select value={filmedBy} onChange={(e) => setFilmedBy(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none">
                <option value="">Select...</option>
                {ENGINEER_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Edited By</label>
              <select value={editedBy} onChange={(e) => setEditedBy(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none">
                <option value="">Select...</option>
                {ENGINEER_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          {/* Client picker */}
          <div>
            <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Client</label>
            {clientName && !manualClientEntry ? (
              <div className="border border-accent px-3 py-2 flex items-center justify-between">
                <div>
                  <span className="font-mono text-sm font-semibold">{clientName}</span>
                  {clientEmail && <span className="font-mono text-xs text-black/40 ml-2">{clientEmail}</span>}
                </div>
                <button onClick={() => { setClientName(''); setClientEmail(''); setManualClientEntry(false); }} className="text-black/30 hover:text-red-500">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : manualClientEntry ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)}
                    className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                    placeholder="Client name" />
                  <input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)}
                    className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                    placeholder="client@email.com" />
                </div>
                <button onClick={() => setManualClientEntry(false)} className="font-mono text-[10px] text-accent hover:underline">
                  Search from users instead
                </button>
              </div>
            ) : (
              <div className="relative" ref={clientPickerRef}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-black/30" />
                  <input type="text" value={clientSearch}
                    onChange={(e) => { setClientSearch(e.target.value); setShowClientPicker(true); }}
                    onFocus={() => setShowClientPicker(true)}
                    className="w-full border border-black/20 pl-8 pr-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                    placeholder="Search users by name or email..." />
                </div>
                {showClientPicker && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-black/20 max-h-48 overflow-y-auto shadow-lg">
                    {filteredClients.map(c => (
                      <button key={c.id} onClick={() => {
                        setClientName(c.display_name); setClientEmail(c.email || '');
                        setShowClientPicker(false); setClientSearch('');
                      }} className="w-full px-3 py-2 flex items-center gap-2 hover:bg-accent/10 text-left border-b border-black/5 last:border-0">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-semibold truncate">{c.display_name}</p>
                          {c.email && <p className="font-mono text-[10px] text-black/40 truncate">{c.email}</p>}
                        </div>
                      </button>
                    ))}
                    {filteredClients.length === 0 && (
                      <p className="px-3 py-2 font-mono text-xs text-black/30">No users found</p>
                    )}
                    <button onClick={() => { setManualClientEntry(true); setShowClientPicker(false); setClientSearch(''); }}
                      className="w-full px-3 py-2 flex items-center gap-2 hover:bg-accent/10 text-left border-t border-black/10">
                      <UserPlus className="w-3 h-3 text-accent" />
                      <span className="font-mono text-xs text-accent font-bold">Enter manually</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none resize-vertical"
              placeholder="Additional details..." />
          </div>

          {/* Preview */}
          {amount && (
            <div className="border border-black/10 p-3 font-mono text-xs space-y-1">
              <div className="flex justify-between"><span className="text-black/50">Sale Total</span><span className="font-bold">${parseFloat(amount || '0').toFixed(2)}</span></div>
              {soldBy && <div className="flex justify-between"><span className="text-black/50">{soldBy} Commission (15%)</span><span className="text-accent font-bold">${(parseFloat(amount || '0') * MEDIA_COMMISSION).toFixed(2)}</span></div>}
              <div className="flex justify-between"><span className="text-black/50">Business Revenue</span><span>${(parseFloat(amount || '0') * (1 - (soldBy ? MEDIA_COMMISSION : 0))).toFixed(2)}</span></div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !description || !amount}
              className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-accent/90 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Log Sale'}
            </button>
            <button onClick={() => { setShowForm(false); resetForm(); }}
              className="border border-black/20 font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-black/5 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="font-mono text-sm text-black/40">Loading...</p>
      ) : (
        <>
          {/* Overview Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="border-2 border-accent p-4">
              <DollarSign className="w-4 h-4 text-accent mb-2" />
              <p className="font-heading text-xl text-accent">{formatCents(totalRevenue)}</p>
              <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider">Total Media Revenue</p>
            </div>
            <div className="border-2 border-black/10 p-4">
              <Video className="w-4 h-4 text-black/30 mb-2" />
              <p className="font-heading text-xl">{sales.length}</p>
              <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider">Total Sales</p>
            </div>
            {byType.map(([type, data]) => (
              <div key={type} className="border-2 border-black/10 p-4">
                <p className="font-heading text-xl">{formatCents(data.revenue)}</p>
                <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider">{SALE_TYPES.find(t => t.value === type)?.label || type} ({data.count})</p>
              </div>
            ))}
          </div>

          {/* Per-Person Payout Breakdown */}
          {personPayouts.length > 0 && (
            <div className="border border-black/10 p-4">
              <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3">Team Payouts & Involvement</h3>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-black/10">
                    <th className="text-left font-mono text-[10px] text-black/40 uppercase tracking-wider py-2">Person</th>
                    <th className="text-right font-mono text-[10px] text-black/40 uppercase tracking-wider py-2">Sales Brought In</th>
                    <th className="text-right font-mono text-[10px] text-black/40 uppercase tracking-wider py-2">Sales Revenue</th>
                    <th className="text-right font-mono text-[10px] text-black/40 uppercase tracking-wider py-2">Commission Owed (15%)</th>
                    <th className="text-right font-mono text-[10px] text-black/40 uppercase tracking-wider py-2">Filmed</th>
                    <th className="text-right font-mono text-[10px] text-black/40 uppercase tracking-wider py-2">Edited</th>
                  </tr>
                </thead>
                <tbody>
                  {personPayouts.map(([name, data]) => (
                    <tr key={name} className="border-b border-black/5">
                      <td className="font-mono text-sm font-semibold py-2">{name}</td>
                      <td className="font-mono text-sm text-right">{data.soldCount}</td>
                      <td className="font-mono text-sm text-right">{formatCents(data.soldRevenue)}</td>
                      <td className="font-mono text-sm text-right font-bold text-accent">{formatCents(data.soldCommission)}</td>
                      <td className="font-mono text-sm text-right text-black/50">{data.filmedCount || '—'}</td>
                      <td className="font-mono text-sm text-right text-black/50">{data.editedCount || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* By Seller Breakdown */}
          {bySeller.length > 0 && (
            <div className="border border-black/10 p-4">
              <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3">Commission by Seller</h3>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-black/10">
                    <th className="text-left font-mono text-[10px] text-black/40 uppercase tracking-wider py-2">Seller</th>
                    <th className="text-right font-mono text-[10px] text-black/40 uppercase tracking-wider py-2">Sales</th>
                    <th className="text-right font-mono text-[10px] text-black/40 uppercase tracking-wider py-2">Revenue</th>
                    <th className="text-right font-mono text-[10px] text-black/40 uppercase tracking-wider py-2">Commission (15%)</th>
                  </tr>
                </thead>
                <tbody>
                  {bySeller.map(([name, data]) => (
                    <tr key={name} className="border-b border-black/5">
                      <td className="font-mono text-sm font-semibold py-2">{name}</td>
                      <td className="font-mono text-sm text-right">{data.count}</td>
                      <td className="font-mono text-sm text-right">{formatCents(data.revenue)}</td>
                      <td className="font-mono text-sm text-right font-bold text-accent">{formatCents(data.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Sales List */}
          <div>
            <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3">All Sales ({sales.length})</h3>
            {sales.length === 0 ? (
              <p className="font-mono text-xs text-black/30 border border-black/10 p-6 text-center">No media sales logged yet.</p>
            ) : (
              <div className="space-y-2">
                {sales.map(sale => (
                  <div key={sale.id} className="border border-black/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-sm font-bold">{sale.description}</span>
                          <span className="font-mono text-[10px] bg-black/5 px-1.5 py-0.5 uppercase">{sale.sale_type}</span>
                        </div>
                        <div className="font-mono text-xs text-black/50 space-x-3">
                          {sale.client_name && <span>Client: {sale.client_name}</span>}
                          <span>{fmtStampDate(sale.created_at, { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                        </div>
                        <div className="font-mono text-xs text-black/40 mt-1 space-x-3">
                          {sale.sold_by && <span>Sold: <strong className="text-black/70">{sale.sold_by}</strong></span>}
                          {sale.filmed_by && <span>Filmed: <strong className="text-black/70">{sale.filmed_by}</strong></span>}
                          {sale.edited_by && <span>Edited: <strong className="text-black/70">{sale.edited_by}</strong></span>}
                        </div>
                        {sale.notes && <p className="font-mono text-[10px] text-black/30 mt-1">{sale.notes}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-mono text-sm font-bold">{formatCents(sale.amount)}</p>
                        {sale.sold_by && (
                          <p className="font-mono text-[10px] text-accent">{formatCents(Math.round(sale.amount * MEDIA_COMMISSION))} commission</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button onClick={() => startEdit(sale)} className="text-black/40 hover:text-accent p-1" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(sale.id)} className="text-red-400 hover:text-red-600 p-1" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
