'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { X, Search, UserPlus, DollarSign, Upload } from 'lucide-react';
import { BEAT_LICENSES, type BeatLicenseType } from '@/lib/constants';

interface PrivateSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  preselectedBeat?: {
    id: string;
    title: string;
    producer: string;
    producerId: string;
    mp3Price: number | null;
    trackoutPrice: number | null;
    exclusivePrice: number | null;
    coverImageUrl: string | null;
  };
  producerId?: string;
  producerName?: string;
}

const PAYMENT_METHODS = [
  { value: 'stripe', label: 'Send Stripe Payment Link', requiresPayment: true },
  { value: 'cash', label: 'Already Paid — Cash', requiresPayment: false },
  { value: 'venmo', label: 'Already Paid — Venmo', requiresPayment: false },
  { value: 'zelle', label: 'Already Paid — Zelle', requiresPayment: false },
  { value: 'other', label: 'Already Paid — Other', requiresPayment: false },
  { value: 'free', label: 'Free / Gifted', requiresPayment: false },
];

const LICENSE_OPTIONS: { value: BeatLicenseType; label: string }[] = [
  { value: 'mp3_lease', label: BEAT_LICENSES.mp3_lease.name },
  { value: 'trackout_lease', label: BEAT_LICENSES.trackout_lease.name },
  { value: 'exclusive', label: BEAT_LICENSES.exclusive.name },
];

export default function PrivateSaleModal({
  isOpen,
  onClose,
  onCreated,
  preselectedBeat,
  producerId,
  producerName,
}: PrivateSaleModalProps) {
  // Client picker state (same pattern as MediaSales.tsx)
  const [clients, setClients] = useState<{ id: string; display_name: string; email: string | null }[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [manualClientEntry, setManualClientEntry] = useState(false);
  const clientPickerRef = useRef<HTMLDivElement>(null);

  // Form state
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [selectedBeatId, setSelectedBeatId] = useState(preselectedBeat?.id || '');
  const [customBeatTitle, setCustomBeatTitle] = useState('');
  const [isCustomBeat, setIsCustomBeat] = useState(false);
  const [licenseType, setLicenseType] = useState<BeatLicenseType>('mp3_lease');
  const [price, setPrice] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('stripe');
  const [notes, setNotes] = useState('');

  // File uploads for custom beats
  const [beatFile, setBeatFile] = useState<File | null>(null);
  const [stemsFile, setStemsFile] = useState<File | null>(null);

  // Beat list for dropdown (when no preselectedBeat)
  const [producerBeats, setProducerBeats] = useState<{ id: string; title: string; mp3_lease_price: number | null; trackout_lease_price: number | null; exclusive_price: number | null }[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Fetch clients
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/admin/library/clients').then(r => r.json()).then(d => setClients(d.clients || [])).catch(() => {});
  }, [isOpen]);

  // Fetch producer beats if no preselected beat
  useEffect(() => {
    if (!isOpen || preselectedBeat) return;
    const url = producerId ? `/api/admin/beats?producerId=${producerId}` : '/api/admin/beats';
    fetch(url).then(r => r.json()).then(d => setProducerBeats(d.beats || [])).catch(() => {});
  }, [isOpen, preselectedBeat, producerId]);

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

  // Auto-populate price from beat pricing when license type changes
  useEffect(() => {
    let priceMap: Record<BeatLicenseType, number | null>;
    if (preselectedBeat) {
      priceMap = {
        mp3_lease: preselectedBeat.mp3Price,
        trackout_lease: preselectedBeat.trackoutPrice,
        exclusive: preselectedBeat.exclusivePrice,
      };
    } else {
      const storeBeat = producerBeats.find(b => b.id === selectedBeatId);
      if (!storeBeat) return;
      priceMap = {
        mp3_lease: storeBeat.mp3_lease_price,
        trackout_lease: storeBeat.trackout_lease_price,
        exclusive: storeBeat.exclusive_price,
      };
    }
    const cents = priceMap[licenseType];
    if (cents) setPrice((cents / 100).toFixed(2));
  }, [licenseType, selectedBeatId, preselectedBeat, producerBeats]);

  // Reset when payment method is "free"
  useEffect(() => {
    if (paymentMethod === 'free') setPrice('0');
  }, [paymentMethod]);

  function resetForm() {
    setBuyerName(''); setBuyerEmail(''); setSelectedBeatId(preselectedBeat?.id || '');
    setCustomBeatTitle(''); setIsCustomBeat(false); setLicenseType('mp3_lease');
    setPrice(''); setPaymentMethod('stripe'); setNotes('');
    setBeatFile(null); setStemsFile(null);
    setManualClientEntry(false); setClientSearch(''); setShowClientPicker(false); setError('');
  }

  async function handleSubmit() {
    if (!buyerEmail) { setError('Buyer email is required'); return; }
    if (!buyerName) { setError('Buyer name is required'); return; }

    const beatTitle = preselectedBeat
      ? preselectedBeat.title
      : isCustomBeat
      ? customBeatTitle
      : producerBeats.find(b => b.id === selectedBeatId)?.title || '';

    if (!beatTitle) { setError('Beat title is required'); return; }

    const pm = PAYMENT_METHODS.find(m => m.value === paymentMethod);

    setSubmitting(true);
    setError('');

    try {
      const beatId = preselectedBeat?.id || (isCustomBeat ? null : selectedBeatId) || null;
      const hasFiles = (isCustomBeat || !beatId) && (beatFile || stemsFile);

      let res: Response;
      if (hasFiles) {
        // Use FormData for file uploads
        const formData = new FormData();
        if (beatId) formData.append('beatId', beatId);
        formData.append('beatTitle', beatTitle);
        formData.append('beatProducer', preselectedBeat?.producer || producerName || '');
        if (preselectedBeat?.producerId || producerId) formData.append('producerId', preselectedBeat?.producerId || producerId || '');
        formData.append('licenseType', licenseType);
        formData.append('amount', String(parseFloat(price) || 0));
        formData.append('paymentMethod', paymentMethod);
        formData.append('requiresPayment', String(pm?.requiresPayment ?? true));
        formData.append('buyerName', buyerName);
        formData.append('buyerEmail', buyerEmail);
        if (notes) formData.append('notes', notes);
        if (beatFile) formData.append('beat_file', beatFile);
        if (stemsFile) formData.append('stems_file', stemsFile);

        res = await fetch('/api/beats/private-sale', { method: 'POST', body: formData });
      } else {
        res = await fetch('/api/beats/private-sale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            beatId,
            beatTitle,
            beatProducer: preselectedBeat?.producer || producerName || '',
            producerId: preselectedBeat?.producerId || producerId || null,
            licenseType,
            amount: parseFloat(price) || 0,
            paymentMethod: paymentMethod,
            requiresPayment: pm?.requiresPayment ?? true,
            buyerName,
            buyerEmail,
            notes: notes || null,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create private sale');
      } else {
        resetForm();
        onCreated();
        onClose();
      }
    } catch {
      setError('Failed to create private sale');
    }
    setSubmitting(false);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-black/10">
          <div>
            <h3 className="font-mono text-lg font-bold uppercase">Private Sale</h3>
            <p className="font-mono text-xs text-black/50 mt-1">
              {preselectedBeat ? `Selling "${preselectedBeat.title}"` : 'Create a private beat sale'}
            </p>
          </div>
          <button onClick={onClose} className="text-black/30 hover:text-black p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <div className="p-6 space-y-4">
          {/* Client Picker — same pattern as MediaSales.tsx */}
          <div>
            <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Client *</label>
            {buyerName && !manualClientEntry ? (
              <div className="border border-accent px-3 py-2 flex items-center justify-between">
                <div>
                  <span className="font-mono text-sm font-semibold">{buyerName}</span>
                  {buyerEmail && <span className="font-mono text-xs text-black/40 ml-2">{buyerEmail}</span>}
                </div>
                <button onClick={() => { setBuyerName(''); setBuyerEmail(''); setManualClientEntry(false); }} className="text-black/30 hover:text-red-500">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : manualClientEntry ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)}
                    className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                    placeholder="Client name" />
                  <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)}
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
                        setBuyerName(c.display_name); setBuyerEmail(c.email || '');
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

          {/* Beat Selection (only if no preselectedBeat) */}
          {!preselectedBeat && (
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Beat *</label>
              {isCustomBeat ? (
                <div className="space-y-2">
                  <input type="text" value={customBeatTitle} onChange={e => setCustomBeatTitle(e.target.value)}
                    className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                    placeholder="Custom beat title..." />
                  <button onClick={() => setIsCustomBeat(false)} className="font-mono text-[10px] text-accent hover:underline">
                    Select from store beats instead
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <select value={selectedBeatId} onChange={e => setSelectedBeatId(e.target.value)}
                    className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white">
                    <option value="">Select a beat...</option>
                    {producerBeats.map(b => (
                      <option key={b.id} value={b.id}>{b.title}</option>
                    ))}
                  </select>
                  <button onClick={() => setIsCustomBeat(true)} className="font-mono text-[10px] text-accent hover:underline">
                    Custom beat (not in store)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* File Uploads (for custom beats or beats without files) */}
          {(isCustomBeat || (!preselectedBeat && !selectedBeatId)) && (
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-2">Beat Files</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[10px] text-black/40 uppercase mb-1">Beat Audio (MP3/WAV) *</label>
                  <label className="border border-dashed border-black/20 p-3 flex items-center gap-2 cursor-pointer hover:border-accent transition-colors">
                    <Upload className="w-4 h-4 text-black/30 flex-shrink-0" />
                    <span className="font-mono text-[10px] text-black/50 truncate">
                      {beatFile ? beatFile.name : 'Select file...'}
                    </span>
                    <input type="file" accept="audio/*,.wav,.mp3,.flac" onChange={e => setBeatFile(e.target.files?.[0] || null)} className="hidden" />
                  </label>
                </div>
                <div>
                  <label className="block font-mono text-[10px] text-black/40 uppercase mb-1">Stems/Trackout (ZIP)</label>
                  <label className="border border-dashed border-black/20 p-3 flex items-center gap-2 cursor-pointer hover:border-accent transition-colors">
                    <Upload className="w-4 h-4 text-black/30 flex-shrink-0" />
                    <span className="font-mono text-[10px] text-black/50 truncate">
                      {stemsFile ? stemsFile.name : 'Select file...'}
                    </span>
                    <input type="file" accept=".zip,.rar" onChange={e => setStemsFile(e.target.files?.[0] || null)} className="hidden" />
                  </label>
                </div>
              </div>
              <p className="font-mono text-[10px] text-black/30 mt-1">Files delivered to buyer after signing the agreement.</p>
            </div>
          )}

          {/* License Type */}
          <div>
            <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">License Type *</label>
            <select value={licenseType} onChange={e => setLicenseType(e.target.value as BeatLicenseType)}
              className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white">
              {LICENSE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Price */}
          <div>
            <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Price *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-black/30">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={e => setPrice(e.target.value)}
                disabled={paymentMethod === 'free'}
                className="w-full border border-black/20 pl-7 pr-3 py-2 font-mono text-sm focus:border-accent focus:outline-none disabled:opacity-30"
                placeholder="29.99"
              />
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Payment Method *</label>
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
              className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white">
              {PAYMENT_METHODS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none resize-vertical"
              placeholder="Optional notes..." />
          </div>

          {/* Error */}
          {error && <p className="font-mono text-sm text-red-600">{error}</p>}

          {/* Preview */}
          {(buyerName || price) && (
            <div className="border border-black/10 p-3 font-mono text-xs space-y-1">
              {buyerName && <div className="flex justify-between"><span className="text-black/50">Buyer</span><span className="font-bold">{buyerName}</span></div>}
              <div className="flex justify-between"><span className="text-black/50">License</span><span>{LICENSE_OPTIONS.find(o => o.value === licenseType)?.label}</span></div>
              <div className="flex justify-between"><span className="text-black/50">Amount</span><span className="font-bold">${parseFloat(price || '0').toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-black/50">Payment</span><span>{PAYMENT_METHODS.find(m => m.value === paymentMethod)?.label}</span></div>
            </div>
          )}

          {/* Submit */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSubmit}
              disabled={submitting || !buyerName || !buyerEmail}
              className="flex-1 bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-accent/90 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
            >
              <DollarSign className="w-3 h-3" />
              {submitting ? 'Creating...' : 'Create Private Sale'}
            </button>
            <button
              onClick={() => { resetForm(); onClose(); }}
              className="border border-black/20 font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-black/5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
