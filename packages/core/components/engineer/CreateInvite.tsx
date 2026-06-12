'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Copy, Check, Link as LinkIcon, Search, UserPlus, X, Video, Trash2, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { formatCents, formatTime, parseTimeSlot } from '@/lib/utils';
import { priceSessionFromConfig, type StudioConfig } from '@/lib/studio-config';

type EngineerOpt = { name: string; displayName: string };

interface Client {
  id: string;
  user_id: string;
  display_name: string;
  email: string | null;
  profile_picture_url: string | null;
}

export default function CreateInvite({ studios, engineers }: { studios: StudioConfig[]; engineers: readonly EngineerOpt[] }) {
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('11:00');
  const [duration, setDuration] = useState(2);
  const [room, setRoom] = useState<string>(studios[0]?.slug ?? 'studio_a');
  const [clientEmail, setClientEmail] = useState('');
  const [clientName, setClientName] = useState('');
  const [artistName, setArtistName] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'cash'>('online');
  const [chargeFullAmount, setChargeFullAmount] = useState(false);
  const [customPrice, setCustomPrice] = useState('');
  const [creating, setCreating] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Media service state
  const [showMediaSection, setShowMediaSection] = useState(false);
  const [mediaAddons, setMediaAddons] = useState<Array<{ type: string; description: string; amount: string; soldBy: string; filmedBy: string; editedBy: string }>>([]);

  // Client picker state
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Fetch client library
  useEffect(() => {
    fetch('/api/admin/library/clients')
      .then((r) => r.json())
      .then((d) => setClients(d.clients || []))
      .catch(() => {});
  }, []);

  // Close picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowClientPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients.slice(0, 10);
    const q = clientSearch.toLowerCase();
    return clients.filter((c) =>
      c.display_name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [clients, clientSearch]);

  function selectClient(client: Client) {
    setSelectedClient(client);
    setClientName(client.display_name || '');
    setClientEmail(client.email || '');
    setShowClientPicker(false);
    setClientSearch('');
    setManualEntry(false);
  }

  function clearClient() {
    setSelectedClient(null);
    setClientName('');
    setClientEmail('');
    setManualEntry(false);
  }

  function switchToManual() {
    setSelectedClient(null);
    setManualEntry(true);
    setShowClientPicker(false);
    setClientSearch('');
  }

  // Current room's DB-driven config (rates / hours / surcharges / deposit %).
  const cfg = useMemo(() => studios.find((s) => s.slug === room) ?? studios[0], [studios, room]);
  const sameDayCents = cfg.surcharges.find((s) => s.kind === 'same_day')?.amountCents ?? 0;
  const startHour = parseTimeSlot(startTime);
  // Check if the selected date is today (Fort Wayne time) for same-day surcharge
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Indiana/Indianapolis' });
  const isSameDay = date === todayLocal;
  const pricing = priceSessionFromConfig(cfg, { hours: duration, startHour, sameDay: isSameDay, guests: 1 });
  const useCustomPrice = customPrice.trim() !== '';
  const customPriceCents = useCustomPrice ? Math.round(parseFloat(customPrice) * 100) : 0;
  const finalTotal = useCustomPrice ? customPriceCents : pricing.total;
  const mediaTotalCents = mediaAddons.reduce((s, a) => s + Math.round(parseFloat(a.amount || '0') * 100), 0);
  const combinedTotal = finalTotal + mediaTotalCents;
  const finalDeposit = chargeFullAmount ? combinedTotal : Math.round(combinedTotal * (cfg.depositPercent / 100));

  // Generate 30-min time slots
  const timeSlots: string[] = [];
  for (let h = 0; h < 24; h++) {
    timeSlots.push(`${h}:00`);
    timeSlots.push(`${h}:30`);
  }

  async function handleCreate() {
    if (!date || !startTime) return;
    // Past-time guard: warn (don't block) if the session is in the past in Fort
    // Wayne. Catches an accidental AM/PM mis-pick or wrong-date entry. Back-dating
    // a walk-in is legitimate, so the engineer can still proceed.
    const nowFW = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' }));
    const nowDec = nowFW.getHours() + nowFW.getMinutes() / 60;
    if (date < todayLocal || (date === todayLocal && startHour < nowDec)) {
      if (!confirm(`Heads up — ${date} at ${formatTime(startTime)} is in the past (Fort Wayne time). Create this session anyway?`)) return;
    }
    setCreating(true);

    try {
      const res = await fetch('/api/booking/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          startTime,
          duration,
          room,
          totalAmount: combinedTotal,
          depositAmount: paymentMethod === 'cash' ? 0 : finalDeposit,
          clientEmail,
          clientName,
          artistName,
          notes,
          paymentMethod,
          customPrice: useCustomPrice ? customPriceCents : null,
          mediaAddons: mediaAddons.filter(a => a.amount && parseFloat(a.amount) > 0).length > 0
            ? mediaAddons.filter(a => a.amount && parseFloat(a.amount) > 0).map(a => ({
                type: a.type,
                description: a.description || (a.type === 'video' ? 'Music Video' : a.type === 'photo' ? 'Photo Shoot' : 'Content Creation'),
                amount: Math.round(parseFloat(a.amount) * 100),
                sold_by: a.soldBy || null,
                filmed_by: a.filmedBy || null,
                edited_by: a.editedBy || null,
              }))
            : null,
        }),
      });

      const data = await res.json();
      if (data.inviteUrl) {
        setInviteUrl(data.inviteUrl);
      } else {
        alert(data.error || 'Failed to create invite');
      }
    } catch (err) {
      console.error('Failed to create invite:', err);
    } finally {
      setCreating(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (inviteUrl) {
    return (
      <div className="max-w-lg">
        <div className="border-2 border-accent p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-4">
            <LinkIcon className="w-6 h-6 text-accent" />
            <h3 className="text-heading-sm">INVITE CREATED</h3>
          </div>
          <p className="font-mono text-xs text-black/60 mb-4">
            {clientEmail
              ? `An invite has been emailed to ${clientEmail}. You can also share the link below.`
              : paymentMethod === 'cash'
                ? 'Send this link to the client. They\'ll confirm the session. Payment is collected at the studio.'
                : 'Send this link to the client. They\'ll sign in and pay the deposit online.'}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={inviteUrl}
              readOnly
              className="flex-1 border border-black/20 px-3 py-2 font-mono text-xs bg-black/5 truncate"
            />
            <button
              onClick={copyLink}
              className="bg-black text-white px-4 py-2 font-mono text-xs font-bold inline-flex items-center gap-1"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => { setInviteUrl(''); setDate(''); clearClient(); setArtistName(''); setNotes(''); setCustomPrice(''); setShowMediaSection(false); setMediaAddons([]); }}
            className="font-mono text-xs text-accent hover:underline mt-4"
          >
            Create another invite
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <p className="font-mono text-sm text-black/60">
        Create a session and send the link to your client. You&apos;ll be auto-assigned as the engineer.
      </p>

      {/* Payment Method */}
      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">Payment Method</label>
        <div className="flex gap-3">
          <button
            onClick={() => setPaymentMethod('online')}
            className={`flex-1 p-3 border-2 font-mono text-xs font-bold uppercase transition-colors ${
              paymentMethod === 'online' ? 'bg-black text-white border-black' : 'border-black/20 hover:border-black'
            }`}
          >
            Pay Online (Stripe)
          </button>
          <button
            onClick={() => setPaymentMethod('cash')}
            className={`flex-1 p-3 border-2 font-mono text-xs font-bold uppercase transition-colors ${
              paymentMethod === 'cash' ? 'bg-black text-white border-black' : 'border-black/20 hover:border-black'
            }`}
          >
            Cash at Studio
          </button>
        </div>
        {paymentMethod === 'online' && (
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input type="checkbox" checked={chargeFullAmount} onChange={(e) => setChargeFullAmount(e.target.checked)}
              className="w-4 h-4 accent-accent" />
            <span className="font-mono text-xs text-black/60">Charge full amount upfront (no deposit split)</span>
          </label>
        )}
      </div>

      {/* Artist Name */}
      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">Artist / Stage Name</label>
        <input type="text" value={artistName} onChange={(e) => setArtistName(e.target.value)}
          className="w-full border-2 border-black/20 px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none"
          placeholder="Stage name (optional)" />
      </div>

      {/* Client Selection */}
      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">Client</label>

        {/* Selected client display */}
        {selectedClient && !manualEntry ? (
          <div className="border-2 border-accent p-3 flex items-center gap-3">
            <div className="w-8 h-8 bg-black/5 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {selectedClient.profile_picture_url ? (
                <img src={selectedClient.profile_picture_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="font-heading text-sm text-black/20">{selectedClient.display_name?.[0]}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-mono text-sm font-semibold truncate">{selectedClient.display_name}</p>
              {selectedClient.email && (
                <p className="font-mono text-[10px] text-black/60 truncate">{selectedClient.email}</p>
              )}
            </div>
            <button onClick={clearClient} className="text-black/30 hover:text-red-500 p-1 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : manualEntry ? (
          /* Manual email/name entry */
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Name</label>
                <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)}
                  className="w-full border-2 border-black/20 px-3 py-2.5 font-mono text-sm focus:border-accent focus:outline-none"
                  placeholder="Client name" />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Email</label>
                <input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)}
                  className="w-full border-2 border-black/20 px-3 py-2.5 font-mono text-sm focus:border-accent focus:outline-none"
                  placeholder="client@email.com" />
              </div>
            </div>
            <button onClick={clearClient} className="font-mono text-[10px] text-accent hover:underline">
              &larr; Search from library instead
            </button>
          </div>
        ) : (
          /* Client search picker */
          <div className="relative" ref={pickerRef}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => { setClientSearch(e.target.value); setShowClientPicker(true); }}
                onFocus={() => setShowClientPicker(true)}
                className="w-full border-2 border-black/20 pl-9 pr-4 py-3 font-mono text-sm focus:border-accent focus:outline-none"
                placeholder="Search clients by name or email..."
              />
            </div>

            {/* Dropdown */}
            {showClientPicker && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border-2 border-black/20 max-h-64 overflow-y-auto shadow-lg">
                {filteredClients.length > 0 ? (
                  filteredClients.map((client) => (
                    <button
                      key={client.id}
                      onClick={() => selectClient(client)}
                      className="w-full p-3 flex items-center gap-3 hover:bg-accent/10 transition-colors text-left border-b border-black/5 last:border-0"
                    >
                      <div className="w-7 h-7 bg-black/5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {client.profile_picture_url ? (
                          <img src={client.profile_picture_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="font-heading text-xs text-black/20">{client.display_name?.[0]}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-xs font-semibold truncate">{client.display_name}</p>
                        {client.email && (
                          <p className="font-mono text-[10px] text-black/60 truncate">{client.email}</p>
                        )}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-3 text-center">
                    <p className="font-mono text-xs text-black/60">No clients found</p>
                  </div>
                )}

                {/* Manual entry option */}
                <button
                  onClick={switchToManual}
                  className="w-full p-3 flex items-center gap-2 hover:bg-accent/10 transition-colors text-left border-t border-black/10"
                >
                  <UserPlus className="w-4 h-4 text-accent" />
                  <span className="font-mono text-xs text-accent font-bold">Enter email manually</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">Date *</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="w-full border-2 border-black px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none" />
      </div>

      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">Start Time *</label>
        <select value={startTime} onChange={(e) => setStartTime(e.target.value)}
          className="w-full border-2 border-black px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none">
          {timeSlots.map((slot) => (
            <option key={slot} value={slot}>{formatTime(slot)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">Duration: {duration} hours</label>
        <div className="flex gap-2">
          {Array.from({ length: cfg.maxHours }, (_, i) => i + 1).map((h) => (
            <button key={h} onClick={() => setDuration(h)}
              className={`w-12 h-12 font-mono text-sm font-bold border transition-colors ${
                duration === h ? 'bg-black text-white border-black' : 'border-black/20 hover:border-black'
              }`}>
              {h}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">Studio</label>
        <div className="flex gap-3">
          {studios.map((s) => (
            <button key={s.slug} onClick={() => setRoom(s.slug)}
              className={`flex-1 p-3 border-2 font-mono text-xs font-bold uppercase transition-colors ${
                room === s.slug ? 'bg-black text-white border-black' : 'border-black/20 hover:border-black'
              }`}>
              {s.displayName} — {formatCents(s.hourlyRateCents)}/hr
            </button>
          ))}
        </div>
      </div>

      {/* Custom Price Override */}
      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">
          Custom Total Price <span className="font-normal text-black/60">(leave blank for standard rate)</span>
        </label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">$</span>
          <input
            type="number"
            step="0.01"
            value={customPrice}
            onChange={(e) => setCustomPrice(e.target.value)}
            className="w-32 border-2 border-black/20 px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none"
            placeholder={`${(pricing.total / 100).toFixed(2)}`}
          />
          {useCustomPrice && (
            <button onClick={() => setCustomPrice('')} className="font-mono text-[10px] text-red-500 hover:underline">
              Reset to standard
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          className="w-full border-2 border-black/20 px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none resize-vertical"
          placeholder="Session details..." />
      </div>

      {/* Media Service */}
      <div>
        <button
          type="button"
          onClick={() => {
            setShowMediaSection(!showMediaSection);
            if (!showMediaSection && mediaAddons.length === 0) {
              setMediaAddons([{ type: 'video', description: '', amount: '', soldBy: '', filmedBy: '', editedBy: '' }]);
            }
          }}
          className={`w-full flex items-center justify-between p-3 border-2 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
            showMediaSection ? 'border-accent bg-accent/5' : 'border-black/20 hover:border-black'
          }`}
        >
          <span className="flex items-center gap-2">
            <Video className="w-4 h-4" />
            Add Media Service
          </span>
          {showMediaSection ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showMediaSection && (
          <div className="border-2 border-t-0 border-black/20 p-4 space-y-4">
            {mediaAddons.map((addon, idx) => (
              <div key={idx} className="space-y-3 pb-4 border-b border-black/10 last:border-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-black/60">Service {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = mediaAddons.filter((_, i) => i !== idx);
                      setMediaAddons(updated);
                      if (updated.length === 0) setShowMediaSection(false);
                    }}
                    className="text-black/30 hover:text-red-500 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Type */}
                  <div>
                    <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Type</label>
                    <select
                      value={addon.type}
                      onChange={(e) => {
                        const updated = [...mediaAddons];
                        updated[idx] = { ...updated[idx], type: e.target.value };
                        setMediaAddons(updated);
                      }}
                      className="w-full border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
                    >
                      <option value="video">Music Video</option>
                      <option value="photo">Photo Shoot</option>
                      <option value="content">Content Creation</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Amount</label>
                    <div className="flex items-center">
                      <span className="font-mono text-xs px-2 py-2 border border-r-0 border-black/20 bg-black/5">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={addon.amount}
                        onChange={(e) => {
                          const updated = [...mediaAddons];
                          updated[idx] = { ...updated[idx], amount: e.target.value };
                          setMediaAddons(updated);
                        }}
                        className="w-full border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Description</label>
                  <input
                    type="text"
                    value={addon.description}
                    onChange={(e) => {
                      const updated = [...mediaAddons];
                      updated[idx] = { ...updated[idx], description: e.target.value };
                      setMediaAddons(updated);
                    }}
                    className="w-full border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
                    placeholder={addon.type === 'video' ? 'Music Video Package' : addon.type === 'photo' ? 'Photo Shoot Package' : 'Content Creation Package'}
                  />
                </div>

                {/* Sold By / Filmed By / Edited By */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Sold By</label>
                    <select
                      value={addon.soldBy}
                      onChange={(e) => {
                        const updated = [...mediaAddons];
                        updated[idx] = { ...updated[idx], soldBy: e.target.value };
                        setMediaAddons(updated);
                      }}
                      className="w-full border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
                    >
                      <option value="">--</option>
                      {engineers.map((eng) => (
                        <option key={eng.name} value={eng.name}>{eng.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Filmed By</label>
                    <select
                      value={addon.filmedBy}
                      onChange={(e) => {
                        const updated = [...mediaAddons];
                        updated[idx] = { ...updated[idx], filmedBy: e.target.value };
                        setMediaAddons(updated);
                      }}
                      className="w-full border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
                    >
                      <option value="">--</option>
                      {engineers.map((eng) => (
                        <option key={eng.name} value={eng.name}>{eng.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Edited By</label>
                    <select
                      value={addon.editedBy}
                      onChange={(e) => {
                        const updated = [...mediaAddons];
                        updated[idx] = { ...updated[idx], editedBy: e.target.value };
                        setMediaAddons(updated);
                      }}
                      className="w-full border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
                    >
                      <option value="">--</option>
                      {engineers.map((eng) => (
                        <option key={eng.name} value={eng.name}>{eng.displayName}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setMediaAddons([...mediaAddons, { type: 'video', description: '', amount: '', soldBy: '', filmedBy: '', editedBy: '' }])}
              className="w-full flex items-center justify-center gap-2 p-2.5 border border-dashed border-black/20 font-mono text-xs text-black/60 hover:border-accent hover:text-accent transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Another Service
            </button>
          </div>
        )}
      </div>

      {/* Price Summary */}
      <div className="border-2 border-black p-4 font-mono text-sm space-y-2">
        {useCustomPrice ? (
          <div className="flex justify-between">
            <span className="text-black/60">Custom deal — {cfg.displayName} × {duration}hr</span>
            <span>{formatCents(customPriceCents)}</span>
          </div>
        ) : (
          <>
            <div className="flex justify-between text-black/60">
              <span>{cfg.displayName} × {duration}hr @ {formatCents(duration === 1 ? cfg.singleHourRateCents : cfg.hourlyRateCents)}/hr</span>
              <span>{formatCents(pricing.subtotal)}</span>
            </div>
            {pricing.nightFees > 0 && (
              <div className="flex justify-between text-amber-600">
                <span>Night surcharges</span>
                <span>+{formatCents(pricing.nightFees)}</span>
              </div>
            )}
            {pricing.sameDayFee > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Same-day booking (+{formatCents(sameDayCents)}/hr)</span>
                <span>+{formatCents(pricing.sameDayFee)}</span>
              </div>
            )}
          </>
        )}
        <div className="flex justify-between border-t border-black/10 pt-2">
          <span>Session Total</span>
          <span className={mediaTotalCents > 0 ? '' : 'font-bold'}>{formatCents(finalTotal)}</span>
        </div>
        {mediaTotalCents > 0 && (
          <>
            {mediaAddons.filter(a => a.amount && parseFloat(a.amount) > 0).map((a, i) => (
              <div key={i} className="flex justify-between text-purple-700">
                <span>{a.description || (a.type === 'video' ? 'Music Video' : a.type === 'photo' ? 'Photo Shoot' : a.type === 'content' ? 'Content Creation' : 'Media Service')}</span>
                <span>+{formatCents(Math.round(parseFloat(a.amount) * 100))}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-black/10 pt-2 font-bold">
              <span>Combined Total</span>
              <span>{formatCents(combinedTotal)}</span>
            </div>
          </>
        )}
        {paymentMethod === 'online' ? (
          <div className="flex justify-between font-bold">
            <span>{chargeFullAmount ? 'Full Payment Due' : `Client Deposit (${cfg.depositPercent}%)`}</span>
            <span className="text-accent">{formatCents(finalDeposit)}</span>
          </div>
        ) : (
          <div className="flex justify-between font-bold text-green-700">
            <span>Cash — Collected at Studio</span>
            <span>{formatCents(combinedTotal)}</span>
          </div>
        )}
      </div>

      <button
        onClick={handleCreate}
        disabled={!date || !clientName || !clientEmail || creating}
        className="w-full bg-accent text-black font-mono text-base font-bold uppercase tracking-wider py-4 hover:bg-accent/90 transition-colors disabled:opacity-50"
      >
        {creating ? 'CREATING...' : !clientName || !clientEmail ? 'CLIENT REQUIRED' : 'CREATE INVITE LINK'}
      </button>
    </div>
  );
}
