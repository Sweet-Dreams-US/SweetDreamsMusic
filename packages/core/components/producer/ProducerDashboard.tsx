'use client';

import { useState, useEffect, useRef } from 'react';
import { Music, DollarSign, ShoppingCart, TrendingUp, Plus, X, Upload, Trash2, AlertCircle, CheckCircle, FileText, Pencil, MessageSquare } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { PRODUCER_COMMISSION, PLATFORM_COMMISSION, BEAT_LICENSES, BEAT_AGREEMENT_TEXT, BEAT_AGREEMENT_VERSION, BEAT_GENRES } from '@/lib/constants';
import { fmtStampDate } from '@/lib/studio-time';
import PrivateSaleModal from '@/components/beats/PrivateSaleModal';
import ProducerClientSearch from './ProducerClientSearch';

interface Beat {
  id: string;
  title: string;
  genre: string | null;
  bpm: number | null;
  musical_key: string | null;
  tags: string[] | null;
  mp3_lease_price: number | null;
  trackout_lease_price: number | null;
  exclusive_price: number | null;
  has_exclusive: boolean;
  lease_count: number;
  total_lease_revenue: number;
  status: string;
  created_at: string;
  preview_url: string | null;
  cover_image_url: string | null;
}

interface Sale {
  id: string;
  beat_id: string;
  buyer_email: string;
  license_type: string;
  amount_paid: number;
  created_at: string;
  beats: { title: string } | { title: string }[] | null;
}

interface Earnings {
  totalGross: number;
  platformFee: number;
  netEarnings: number;
  totalPaid: number;
  pendingPayout: number;
  totalBeats: number;
  totalLeases: number;
}

type Tab = 'beats' | 'sales' | 'earnings' | 'message';

export default function ProducerDashboard({ isAdmin = false }: { isAdmin?: boolean }) {
  const [tab, setTab] = useState<Tab>('beats');
  const [beats, setBeats] = useState<Beat[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/producer/beats').then((r) => r.json()),
      fetch('/api/producer/sales').then((r) => r.json()),
      fetch('/api/producer/earnings').then((r) => r.json()),
    ]).then(([beatsData, salesData, earningsData]) => {
      setBeats(beatsData.beats || []);
      setSales(salesData.sales || []);
      setEarnings(earningsData);
      setLoading(false);
    });
  }, []);

  const pendingCount = beats.filter((b) => b.status === 'pending_review' || b.status === 'pending_approval').length;

  const tabs: { key: Tab; label: string; icon: typeof Music; badge?: number }[] = [
    { key: 'beats', label: 'My Beats', icon: Music, badge: pendingCount > 0 ? pendingCount : undefined },
    { key: 'sales', label: 'Sales', icon: ShoppingCart },
    { key: 'message', label: 'Message Clients', icon: MessageSquare },
    { key: 'earnings', label: 'Earnings', icon: DollarSign },
  ];

  return (
    <>
      <section className="bg-white text-black min-h-[60vh]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Mobile Tabs — above everything */}
          <div className="lg:hidden mb-6">
              <div className="flex flex-wrap gap-1.5">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-2 transition-colors inline-flex items-center gap-1.5 rounded ${
                      tab === t.key ? 'bg-black text-white' : 'bg-black/5 text-black/50 hover:bg-black/10'
                    }`}
                  >
                    <t.icon className="w-3 h-3" />
                    {t.label}
                    {t.badge && (
                      <span className="bg-red-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full min-w-[16px] text-center">
                        {t.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
          </div>

          <div className="flex gap-8">
            {/* Desktop Sidebar */}
            <aside className="hidden lg:block w-48 shrink-0 self-start sticky top-24">
              <nav className="space-y-1">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`w-full text-left font-mono text-xs font-semibold uppercase tracking-wider px-4 py-3 transition-colors flex items-center gap-2.5 rounded ${
                      tab === t.key ? 'bg-black text-white' : 'text-black/50 hover:bg-black/5 hover:text-black/80'
                    }`}
                  >
                    <t.icon className="w-4 h-4 shrink-0" />
                    {t.label}
                    {t.badge && (
                      <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center ml-auto">
                        {t.badge}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </aside>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
              {loading ? (
                <p className="font-mono text-sm text-black/70">Loading...</p>
              ) : (
                <>
                  {tab === 'beats' && <BeatsTab beats={beats} onBeatsChange={setBeats} isAdmin={isAdmin} />}
                  {tab === 'sales' && <SalesTab sales={sales} />}
                  {tab === 'message' && <ProducerClientSearch />}
                  {tab === 'earnings' && earnings && <EarningsTab earnings={earnings} />}
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

interface PrivateSaleRecord {
  id: string;
  beat_title: string;
  beat_producer: string;
  buyer_name: string | null;
  buyer_email: string;
  license_type: string;
  amount: number;
  payment_method: string;
  status: string;
  created_at: string;
}

const PS_STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-700' },
  signed: { bg: 'bg-blue-100', text: 'text-blue-700' },
  paid: { bg: 'bg-blue-100', text: 'text-blue-700' },
  completed: { bg: 'bg-green-100', text: 'text-green-700' },
  expired: { bg: 'bg-red-100', text: 'text-red-600' },
  cancelled: { bg: 'bg-black/5', text: 'text-black/60' },
};

function BeatsTab({ beats, onBeatsChange, isAdmin = false }: { beats: Beat[]; onBeatsChange: (beats: Beat[]) => void; isAdmin?: boolean }) {
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [reviewBeat, setReviewBeat] = useState<Beat | null>(null);

  // Private sales
  const [showPrivateSale, setShowPrivateSale] = useState(false);
  const [privateSales, setPrivateSales] = useState<PrivateSaleRecord[]>([]);
  const [privateSalesLoading, setPrivateSalesLoading] = useState(true);

  useEffect(() => {
    fetchPrivateSales();
  }, []);

  function fetchPrivateSales() {
    setPrivateSalesLoading(true);
    fetch('/api/beats/private-sale')
      .then(r => r.json())
      .then(data => setPrivateSales(Array.isArray(data) ? data : data.sales || []))
      .catch(() => {})
      .finally(() => setPrivateSalesLoading(false));
  }

  // Form state
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [bpm, setBpm] = useState('');
  const [musicalKey, setMusicalKey] = useState('');
  const [tags, setTags] = useState('');
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [mp3File, setMp3File] = useState<File | null>(null);
  const [trackoutFile, setTrackoutFile] = useState<File | null>(null);
  const [saleMode, setSaleMode] = useState<'full' | 'leases_only' | 'lifetime'>('full');
  const [mp3Price, setMp3Price] = useState('29.99');
  const [trackoutPrice, setTrackoutPrice] = useState('74.99');
  const [exclusivePrice, setExclusivePrice] = useState('400.00');
  const [hasExclusive, setHasExclusive] = useState(true);
  const [containsSamples, setContainsSamples] = useState(false);
  const [sampleDetails, setSampleDetails] = useState('');
  const [uploadError, setUploadError] = useState('');

  const pendingApprovalBeats = beats.filter((b) => b.status === 'pending_approval');
  const pendingReviewBeats = beats.filter((b) => b.status === 'pending_review');
  const pendingBeats = [...pendingApprovalBeats, ...pendingReviewBeats];
  const activeBeats = beats.filter((b) => b.status !== 'pending_review' && b.status !== 'pending_approval' && b.status !== 'rejected');
  const rejectedBeats = beats.filter((b) => b.status === 'rejected');

  function resetForm() {
    setTitle(''); setGenre(''); setBpm(''); setMusicalKey('');
    setTags(''); setPreviewFile(null); setMp3File(null); setTrackoutFile(null);
    setSaleMode('full'); setMp3Price('29.99'); setTrackoutPrice('74.99'); setExclusivePrice('400.00');
    setHasExclusive(true); setContainsSamples(false); setSampleDetails('');
    setUploadError(''); setUploadSuccess(false);
  }

  async function handleUpload() {
    if (!previewFile || !title) return;
    setUploading(true);
    setUploadError('');
    setUploadStatus('Preparing upload...');

    try {
      // Step 1: Get signed upload URLs for all files
      const filesToUpload: { type: string; fileName: string; file: File }[] = [
        { type: 'preview', fileName: previewFile.name, file: previewFile },
      ];
      if (mp3File) filesToUpload.push({ type: 'mp3', fileName: mp3File.name, file: mp3File });
      if (trackoutFile && saleMode === 'full') filesToUpload.push({ type: 'trackout', fileName: trackoutFile.name, file: trackoutFile });

      const urlRes = await fetch('/api/producer/beats/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: filesToUpload.map(f => ({ type: f.type, fileName: f.fileName })),
        }),
      });
      const urlData = await urlRes.json();

      if (!urlRes.ok || !urlData.uploads) {
        setUploadError(urlData.error || 'Failed to prepare upload. Please try again.');
        setUploadStatus('');
        setUploading(false);
        return;
      }

      // Step 2: Upload each file directly to Supabase Storage via signed URLs
      const filePaths: Record<string, string> = {};

      for (const upload of urlData.uploads) {
        const fileEntry = filesToUpload.find(f => f.type === upload.type);
        if (!fileEntry) continue;

        const label = upload.type === 'preview' ? 'preview audio' : upload.type === 'mp3' ? 'MP3 master' : 'trackout/stems';
        setUploadStatus(`Uploading ${label}...`);

        const uploadRes = await fetch(upload.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': fileEntry.file.type || 'application/octet-stream' },
          body: fileEntry.file,
        });

        if (!uploadRes.ok) {
          const errText = await uploadRes.text().catch(() => 'Unknown error');
          console.error(`${upload.type} upload failed:`, errText);
          // Preview is required, others are optional
          if (upload.type === 'preview') {
            setUploadError('Preview upload failed. Please try again.');
            setUploadStatus('');
            setUploading(false);
            return;
          }
          continue;
        }

        filePaths[upload.type] = upload.filePath;
      }

      setUploadStatus('Saving beat...');

      // Step 3: Create the beat record with file paths
      const res = await fetch('/api/producer/beats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          genre,
          bpm,
          key: musicalKey,
          tags,
          mp3_lease_price: mp3Price,
          trackout_lease_price: saleMode === 'full' ? trackoutPrice : null,
          exclusive_price: saleMode === 'full' ? exclusivePrice : null,
          has_exclusive: saleMode === 'full' ? hasExclusive : false,
          is_lifetime_lease: saleMode === 'lifetime',
          contains_samples: containsSamples,
          sample_details: containsSamples ? sampleDetails : null,
          preview_file_path: filePaths.preview,
          mp3_file_path: filePaths.mp3 || null,
          trackout_file_path: filePaths.trackout || null,
        }),
      });
      const data = await res.json();

      if (data.beat) {
        onBeatsChange([data.beat, ...beats]);
        resetForm();
        setShowForm(false);
        setUploadSuccess(true);
        setTimeout(() => setUploadSuccess(false), 8000);
      } else {
        setUploadError(data.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Beat upload error:', err);
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploadStatus('');
      setUploading(false);
    }
  }

  async function deleteBeat(id: string) {
    if (!confirm('Delete this beat? This cannot be undone.')) return;
    const res = await fetch('/api/producer/beats', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      onBeatsChange(beats.filter((b) => b.id !== id));
    }
  }

  function handleAgreementSigned(beatId: string) {
    // Update beat status locally
    onBeatsChange(beats.map((b) => b.id === beatId ? { ...b, status: 'active' } : b));
    setReviewBeat(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-heading-md">MY BEATS</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPrivateSale(true)}
            className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-black/80 inline-flex items-center gap-1"
          >
            <DollarSign className="w-3 h-3" /> Private Sale
          </button>
          <button
            onClick={() => { setShowForm(!showForm); setUploadSuccess(false); }}
            className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent/90 inline-flex items-center gap-1"
          >
            {showForm ? <><X className="w-3 h-3" /> Cancel</> : <><Plus className="w-3 h-3" /> Upload Beat</>}
          </button>
        </div>
      </div>

      {/* Upload Success Message */}
      {uploadSuccess && (
        <div className="border-2 border-green-500 bg-green-50 p-4 mb-6 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div>
            <p className="font-mono text-sm font-bold text-green-800">Beat uploaded!</p>
            <p className="font-mono text-xs text-green-700">Waiting for admin approval. You will receive an email when your beat is reviewed.</p>
          </div>
        </div>
      )}

      {/* Upload Form */}
      {showForm && (
        <div className="border-2 border-accent p-6 mb-8 space-y-4">
          <h3 className="font-mono text-sm font-bold uppercase">Upload New Beat</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Title *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" placeholder="Beat title" />
            </div>
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Genre</label>
              <select value={genre} onChange={(e) => setGenre(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white">
                <option value="">Select genre...</option>
                {BEAT_GENRES.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">BPM</label>
                <input type="number" value={bpm} onChange={(e) => setBpm(e.target.value)}
                  className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" placeholder="140" />
              </div>
              <div className="flex-1">
                <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Key</label>
                <input type="text" value={musicalKey} onChange={(e) => setMusicalKey(e.target.value)}
                  className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" placeholder="C minor" />
              </div>
            </div>
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Tags (comma separated)</label>
              <input type="text" value={tags} onChange={(e) => setTags(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" placeholder="dark, trap, melodic" />
            </div>
          </div>

          {/* File Uploads */}
          <div className="space-y-3">
            <p className="font-mono text-xs text-black/60 uppercase tracking-wider">Files</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block font-mono text-[10px] text-black/60 uppercase mb-1">Preview Audio (tagged/watermarked) *</label>
                <label className="border border-dashed border-black/20 p-3 flex items-center gap-2 cursor-pointer hover:border-accent transition-colors">
                  <Upload className="w-4 h-4 text-black/30 flex-shrink-0" />
                  <span className="font-mono text-[10px] text-black/70 truncate">
                    {previewFile ? previewFile.name : 'Select file...'}
                  </span>
                  <input type="file" accept="audio/*" onChange={(e) => setPreviewFile(e.target.files?.[0] || null)} className="hidden" />
                </label>
              </div>
              <div>
                <label className="block font-mono text-[10px] text-black/60 uppercase mb-1">MP3 Master (for MP3 lease delivery)</label>
                <label className="border border-dashed border-black/20 p-3 flex items-center gap-2 cursor-pointer hover:border-accent transition-colors">
                  <Upload className="w-4 h-4 text-black/30 flex-shrink-0" />
                  <span className="font-mono text-[10px] text-black/70 truncate">
                    {mp3File ? mp3File.name : 'Select file...'}
                  </span>
                  <input type="file" accept=".mp3,audio/mpeg" onChange={(e) => setMp3File(e.target.files?.[0] || null)} className="hidden" />
                </label>
              </div>
              {saleMode === 'full' && (
              <div>
                <label className="block font-mono text-[10px] text-black/60 uppercase mb-1">Trackout / Stems (ZIP)</label>
                <label className="border border-dashed border-black/20 p-3 flex items-center gap-2 cursor-pointer hover:border-accent transition-colors">
                  <Upload className="w-4 h-4 text-black/30 flex-shrink-0" />
                  <span className="font-mono text-[10px] text-black/70 truncate">
                    {trackoutFile ? trackoutFile.name : 'Select file...'}
                  </span>
                  <input type="file" accept=".zip,.rar" onChange={(e) => setTrackoutFile(e.target.files?.[0] || null)} className="hidden" />
                </label>
              </div>
              )}
            </div>
          </div>

          {/* Sale Mode */}
          <div>
            <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-2">Sale Mode</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <button type="button" onClick={() => setSaleMode('full')}
                className={`flex-1 border-2 p-3 text-left transition-colors ${saleMode === 'full' ? 'border-accent bg-accent/10' : 'border-black/10 hover:border-black/20'}`}>
                <p className="font-mono text-xs font-bold uppercase">Full Licensing</p>
                <p className="font-mono text-[10px] text-black/60 mt-0.5">MP3 Lease + Trackout + Exclusive options</p>
              </button>
              <button type="button" onClick={() => setSaleMode('leases_only')}
                className={`flex-1 border-2 p-3 text-left transition-colors ${saleMode === 'leases_only' ? 'border-accent bg-accent/10' : 'border-black/10 hover:border-black/20'}`}>
                <p className="font-mono text-xs font-bold uppercase">Lease Only</p>
                <p className="font-mono text-[10px] text-black/60 mt-0.5">MP3 lease only. No stems, no exclusive — simplest option. 1-year license, renewable.</p>
              </button>
              <button type="button" onClick={() => setSaleMode('lifetime')}
                className={`flex-1 border-2 p-3 text-left transition-colors ${saleMode === 'lifetime' ? 'border-accent bg-accent/10' : 'border-black/10 hover:border-black/20'}`}>
                <p className="font-mono text-xs font-bold uppercase">Lifetime Lease</p>
                <p className="font-mono text-[10px] text-black/60 mt-0.5">MP3 only — never expires. Buyer owns the lease forever.</p>
              </button>
            </div>
          </div>

          {/* Pricing */}
          <div>
            <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-2">
              {saleMode === 'full' ? 'License Prices ($)' : 'Lease Price ($)'}
            </label>
            <div className={`grid gap-3 ${saleMode === 'full' ? 'grid-cols-3' : 'grid-cols-1 max-w-xs'}`}>
              <div>
                <label className="font-mono text-[10px] text-black/60">
                  {saleMode === 'lifetime' ? 'Lifetime Lease' : saleMode === 'leases_only' ? 'MP3 Lease' : BEAT_LICENSES.mp3_lease.name}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-black/30">$</span>
                  <input type="text" inputMode="decimal" value={mp3Price} onChange={(e) => setMp3Price(e.target.value)}
                    className="w-full border border-black/20 pl-7 pr-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" placeholder="29.99" />
                </div>
              </div>
              {saleMode === 'full' && (
                <>
                  <div>
                    <label className="font-mono text-[10px] text-black/60">{BEAT_LICENSES.trackout_lease.name}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-black/30">$</span>
                      <input type="text" inputMode="decimal" value={trackoutPrice} onChange={(e) => setTrackoutPrice(e.target.value)}
                        className="w-full border border-black/20 pl-7 pr-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" placeholder="74.99" />
                    </div>
                  </div>
                  <div>
                    <label className="font-mono text-[10px] text-black/60">{BEAT_LICENSES.exclusive.name}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-black/30">$</span>
                      <input type="text" inputMode="decimal" value={exclusivePrice} onChange={(e) => setExclusivePrice(e.target.value)}
                        disabled={!hasExclusive}
                        className="w-full border border-black/20 pl-7 pr-3 py-2 font-mono text-sm focus:border-accent focus:outline-none disabled:opacity-30" placeholder="400.00" />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Options */}
          <div className="flex flex-wrap gap-6">
            {saleMode === 'full' && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hasExclusive} onChange={(e) => setHasExclusive(e.target.checked)}
                className="w-4 h-4 accent-accent" />
              <span className="font-mono text-xs text-black/60">Exclusive available</span>
            </label>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={containsSamples} onChange={(e) => setContainsSamples(e.target.checked)}
                className="w-4 h-4 accent-accent" />
              <span className="font-mono text-xs text-black/60">Contains samples</span>
            </label>
          </div>

          {containsSamples && (
            <div>
              <label className="block font-mono text-xs text-black/60 uppercase tracking-wider mb-1">Sample Details</label>
              <input type="text" value={sampleDetails} onChange={(e) => setSampleDetails(e.target.value)}
                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                placeholder="Source, clearance status, royalty-free library used, etc." />
            </div>
          )}

          {uploadError && (
            <p className="font-mono text-sm text-red-600">{uploadError}</p>
          )}

          {uploading && uploadStatus && (
            <p className="font-mono text-sm text-accent">{uploadStatus}</p>
          )}

          <button
            onClick={handleUpload}
            disabled={!previewFile || !title || uploading}
            className="bg-black text-white font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-black/80 disabled:opacity-50"
          >
            {uploading ? (uploadStatus || 'Uploading...') : 'Upload Beat'}
          </button>
        </div>
      )}

      {/* Pending Approval Section (waiting for admin) */}
      {pendingApprovalBeats.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            <h3 className="font-mono text-sm font-bold uppercase">
              Waiting for Admin Approval ({pendingApprovalBeats.length})
            </h3>
          </div>
          <div className="space-y-3">
            {pendingApprovalBeats.map((beat) => (
              <div key={beat.id} className="border-2 border-amber-300 bg-amber-50/50 p-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm font-bold">{beat.title}</p>
                      <span className="bg-amber-200 text-amber-800 font-mono text-[10px] font-bold uppercase px-1.5 py-0.5">
                        Pending Approval
                      </span>
                    </div>
                    <p className="font-mono text-xs text-black/70 mt-0.5">
                      {beat.genre}{beat.bpm && ` · ${beat.bpm} BPM`}{beat.musical_key && ` · ${beat.musical_key}`}
                    </p>
                    <p className="font-mono text-[10px] text-black/50 mt-1">Submitted for admin review. You will be notified when approved.</p>
                  </div>
                  {beat.preview_url && (
                    <audio controls preload="none" className="hidden sm:block max-w-[160px] flex-shrink-0">
                      <source src={beat.preview_url} type="audio/mpeg" />
                    </audio>
                  )}
                  <button onClick={() => deleteBeat(beat.id)} className="text-red-400 hover:text-red-600 p-2 flex-shrink-0" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending Review Section (approved, needs agreement) */}
      {pendingReviewBeats.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <h3 className="font-mono text-sm font-bold uppercase">
              Ready for Agreement ({pendingReviewBeats.length})
            </h3>
          </div>
          <div className="space-y-3">
            {pendingReviewBeats.map((beat) => (
              <div key={beat.id} className="border-2 border-green-400 bg-green-50 p-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-green-100 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm font-bold">{beat.title}</p>
                      <span className="bg-green-200 text-green-800 font-mono text-[10px] font-bold uppercase px-1.5 py-0.5">
                        Approved — Sign Agreement
                      </span>
                    </div>
                    <p className="font-mono text-xs text-black/70 mt-0.5">
                      {beat.genre}{beat.bpm && ` · ${beat.bpm} BPM`}{beat.musical_key && ` · ${beat.musical_key}`}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-1">
                      {beat.mp3_lease_price && <span className="font-mono text-[10px] text-black/60">MP3: {formatCents(beat.mp3_lease_price)}</span>}
                      {beat.trackout_lease_price && <span className="font-mono text-[10px] text-black/60">Trackout: {formatCents(beat.trackout_lease_price)}</span>}
                      {beat.exclusive_price && beat.has_exclusive && <span className="font-mono text-[10px] text-accent font-bold">EXCL: {formatCents(beat.exclusive_price)}</span>}
                    </div>
                  </div>
                  {beat.preview_url && (
                    <audio controls preload="none" className="hidden sm:block max-w-[160px] flex-shrink-0">
                      <source src={beat.preview_url} type="audio/mpeg" />
                    </audio>
                  )}
                  <button
                    onClick={() => setReviewBeat(beat)}
                    className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent/90 flex-shrink-0"
                  >
                    Review & Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rejected Beats */}
      {rejectedBeats.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <X className="w-5 h-5 text-red-500" />
            <h3 className="font-mono text-sm font-bold uppercase">
              Rejected ({rejectedBeats.length})
            </h3>
          </div>
          <div className="space-y-3">
            {rejectedBeats.map((beat) => (
              <div key={beat.id} className="border-2 border-red-200 bg-red-50/50 p-4 opacity-60">
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm font-bold">{beat.title}</p>
                      <span className="bg-red-200 text-red-700 font-mono text-[10px] font-bold uppercase px-1.5 py-0.5">
                        Rejected
                      </span>
                    </div>
                    <p className="font-mono text-xs text-black/70 mt-0.5">
                      {beat.genre}{beat.bpm && ` · ${beat.bpm} BPM`}{beat.musical_key && ` · ${beat.musical_key}`}
                    </p>
                  </div>
                  <button onClick={() => deleteBeat(beat.id)} className="text-red-400 hover:text-red-600 p-2 flex-shrink-0" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agreement Review Modal */}
      {reviewBeat && (
        <AgreementModal
          beat={reviewBeat}
          onClose={() => setReviewBeat(null)}
          onSigned={handleAgreementSigned}
        />
      )}

      {/* Stats */}
      {beats.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="border-2 border-accent p-4">
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Active Beats</p>
            <p className="text-heading-sm">{beats.filter((b) => b.status === 'active').length}</p>
          </div>
          <div className="border-2 border-black/10 p-4">
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Total Leases</p>
            <p className="text-heading-sm">{beats.reduce((sum, b) => sum + (b.lease_count || 0), 0)}</p>
          </div>
          <div className="border-2 border-black/10 p-4">
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Revenue</p>
            <p className="text-heading-sm">{formatCents(beats.reduce((sum, b) => sum + (b.total_lease_revenue || 0), 0))}</p>
          </div>
          <div className="border-2 border-black/10 p-4">
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Exclusives Sold</p>
            <p className="text-heading-sm">{beats.filter((b) => b.status === 'sold_exclusive').length}</p>
          </div>
        </div>
      )}

      {/* Active beat list */}
      {activeBeats.length === 0 && pendingBeats.length === 0 && rejectedBeats.length === 0 && !showForm ? (
        <div className="border-2 border-black/10 p-12 text-center">
          <Music className="w-12 h-12 text-black/10 mx-auto mb-4" />
          <p className="font-mono text-sm text-black/70 mb-4">No beats yet. Upload your first beat!</p>
          <button
            onClick={() => setShowForm(true)}
            className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-accent/90 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Upload Beat
          </button>
        </div>
      ) : activeBeats.length > 0 && (
        <div className="space-y-3">
          {activeBeats.map((beat) => (
            <div key={beat.id} className={`border-2 p-4 ${
              beat.status === 'sold_exclusive' ? 'border-accent/30 bg-accent/5' : 'border-black/10'
            }`}>
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm font-bold">{beat.title}</p>
                    {beat.status === 'sold_exclusive' && (
                      <span className="bg-accent/20 text-accent font-mono text-[10px] font-bold uppercase px-1.5 py-0.5">Sold Exclusive</span>
                    )}
                    {beat.status === 'active' && (
                      <span className="bg-green-100 text-green-700 font-mono text-[10px] font-bold uppercase px-1.5 py-0.5">Live</span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-black/70 mt-0.5">
                    {beat.genre}{beat.bpm && ` · ${beat.bpm} BPM`}{beat.musical_key && ` · ${beat.musical_key}`}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-1">
                    {beat.mp3_lease_price && <span className="font-mono text-[10px] text-black/60">MP3: {formatCents(beat.mp3_lease_price)}</span>}
                    {beat.trackout_lease_price && <span className="font-mono text-[10px] text-black/60">Trackout: {formatCents(beat.trackout_lease_price)}</span>}
                    {beat.exclusive_price && beat.has_exclusive && <span className="font-mono text-[10px] text-accent font-bold">EXCL: {formatCents(beat.exclusive_price)}</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-mono text-xs text-green-600 inline-flex items-center gap-1">
                    <ShoppingCart className="w-3 h-3" /> {beat.lease_count} leases
                  </p>
                  <p className="font-mono text-xs text-black/60 mt-0.5">
                    {formatCents(beat.total_lease_revenue)} gross
                  </p>
                </div>
                {beat.preview_url && (
                  <audio controls preload="none" className="hidden sm:block max-w-[160px] flex-shrink-0">
                    <source src={beat.preview_url} type="audio/mpeg" />
                  </audio>
                )}
                {isAdmin && (
                  <button onClick={() => deleteBeat(beat.id)} className="text-red-400 hover:text-red-600 p-2 flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Private Sales Section */}
      <div className="mt-10">
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-4">Private Sales</h3>
        {privateSalesLoading ? (
          <p className="font-mono text-sm text-black/70">Loading private sales...</p>
        ) : privateSales.length === 0 ? (
          <p className="font-mono text-xs text-black/60 border border-black/10 p-6 text-center">No private sales yet.</p>
        ) : (
          <div className="space-y-2">
            {privateSales.map(sale => {
              const badge = PS_STATUS_BADGE[sale.status] || PS_STATUS_BADGE.pending;
              return (
                <div key={sale.id} className="border border-black/10 p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-sm font-bold truncate">{sale.beat_title}</span>
                      <span className={`${badge.bg} ${badge.text} font-mono text-[10px] font-bold uppercase px-1.5 py-0.5`}>
                        {sale.status}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-black/70">
                      {sale.buyer_name || sale.buyer_email}
                      {' · '}
                      {BEAT_LICENSES[sale.license_type as keyof typeof BEAT_LICENSES]?.name || sale.license_type}
                    </p>
                    <p className="font-mono text-[10px] text-black/60 mt-0.5">
                      {fmtStampDate(sale.created_at, { year: '2-digit' })}
                      {sale.payment_method !== 'stripe' && ` · ${sale.payment_method}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-mono text-sm font-bold">{formatCents(sale.amount)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Private Sale Modal */}
      <PrivateSaleModal
        isOpen={showPrivateSale}
        onClose={() => setShowPrivateSale(false)}
        onCreated={fetchPrivateSales}
      />
    </div>
  );
}

function AgreementModal({ beat, onClose, onSigned }: { beat: Beat; onClose: () => void; onSigned: (beatId: string) => void }) {
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Editable fields
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState(beat.title);
  const [editGenre, setEditGenre] = useState(beat.genre || '');
  const [editBpm, setEditBpm] = useState(String(beat.bpm || ''));
  const [editKey, setEditKey] = useState(beat.musical_key || '');
  const [editTags, setEditTags] = useState((beat.tags || []).join(', '));
  const [localBeat, setLocalBeat] = useState(beat);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottom) setScrolledToBottom(true);
  }

  async function saveEdits() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/producer/beats/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beat_id: localBeat.id,
          title: editTitle,
          genre: editGenre,
          bpm: editBpm,
          musical_key: editKey,
          tags: editTags,
        }),
      });
      const data = await res.json();
      if (data.success && data.beat) {
        setLocalBeat({ ...localBeat, title: data.beat.title, genre: data.beat.genre, bpm: data.beat.bpm, musical_key: data.beat.musical_key, tags: data.beat.tags });
        setEditMode(false);
      } else {
        setError(data.error || 'Failed to save edits');
      }
    } catch {
      setError('Failed to save edits');
    }
    setSaving(false);
  }

  async function handleSign() {
    if (!agreed) return;
    setSigning(true);
    setError('');

    try {
      const res = await fetch('/api/producer/beats/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beat_id: localBeat.id }),
      });
      const data = await res.json();

      if (data.success) {
        onSigned(localBeat.id);
      } else {
        setError(data.error || 'Failed to sign agreement');
      }
    } catch {
      setError('Failed to sign agreement. Please try again.');
    }
    setSigning(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-black/10">
          <div>
            <h3 className="font-mono text-lg font-bold uppercase">Beat Agreement</h3>
            <p className="font-mono text-xs text-black/70 mt-1">Review, edit, and sign to make &quot;{localBeat.title}&quot; live</p>
          </div>
          <button onClick={onClose} className="text-black/30 hover:text-black p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Beat Details — Editable */}
        <div className="px-6 py-4 bg-black/[0.02] border-b border-black/10">
          {editMode ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Title</label>
                  <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full border border-black/20 px-2 py-1.5 font-mono text-sm focus:border-accent focus:outline-none" />
                </div>
                <div>
                  <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Genre</label>
                  <select value={editGenre} onChange={(e) => setEditGenre(e.target.value)}
                    className="w-full border border-black/20 px-2 py-1.5 font-mono text-sm focus:border-accent focus:outline-none bg-white">
                    <option value="">Select genre...</option>
                    {BEAT_GENRES.map((g) => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">BPM</label>
                    <input type="number" value={editBpm} onChange={(e) => setEditBpm(e.target.value)}
                      className="w-full border border-black/20 px-2 py-1.5 font-mono text-sm focus:border-accent focus:outline-none" />
                  </div>
                  <div className="flex-1">
                    <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Key</label>
                    <input type="text" value={editKey} onChange={(e) => setEditKey(e.target.value)}
                      className="w-full border border-black/20 px-2 py-1.5 font-mono text-sm focus:border-accent focus:outline-none" />
                  </div>
                </div>
              </div>
              <div>
                <label className="block font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Tags (comma separated)</label>
                <input type="text" value={editTags} onChange={(e) => setEditTags(e.target.value)}
                  className="w-full border border-black/20 px-2 py-1.5 font-mono text-sm focus:border-accent focus:outline-none" placeholder="dark, trap, melodic" />
              </div>
              <div className="flex gap-2">
                <button onClick={saveEdits} disabled={saving || !editTitle.trim()}
                  className="bg-black text-white font-mono text-xs font-bold uppercase px-4 py-2 hover:bg-black/80 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button onClick={() => { setEditMode(false); setEditTitle(localBeat.title); setEditGenre(localBeat.genre || ''); setEditBpm(String(localBeat.bpm || '')); setEditKey(localBeat.musical_key || ''); setEditTags((localBeat.tags || []).join(', ')); }}
                  className="border border-black/20 text-black/60 font-mono text-xs uppercase px-4 py-2 hover:bg-black/5">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
                  <div>
                    <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Beat</p>
                    <p className="font-mono text-sm font-bold">{localBeat.title}</p>
                  </div>
                  {localBeat.genre && (
                    <div>
                      <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Genre</p>
                      <p className="font-mono text-sm">{localBeat.genre}</p>
                    </div>
                  )}
                  {localBeat.bpm && (
                    <div>
                      <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">BPM</p>
                      <p className="font-mono text-sm">{localBeat.bpm}</p>
                    </div>
                  )}
                  <div>
                    <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Revenue Split</p>
                    <p className="font-mono text-sm font-bold text-accent">You keep 60%</p>
                  </div>
                </div>
                <button onClick={() => setEditMode(true)}
                  className="text-black/30 hover:text-accent p-1 flex-shrink-0" title="Edit details">
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
              {localBeat.tags && localBeat.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {localBeat.tags.map((tag, i) => (
                    <span key={i} className="font-mono text-[10px] text-black/60 border border-black/10 px-1.5 py-0.5">{tag}</span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-3 mt-2">
                {localBeat.mp3_lease_price && <span className="font-mono text-[10px] text-black/70">MP3 Lease: {formatCents(localBeat.mp3_lease_price)}</span>}
                {localBeat.trackout_lease_price && <span className="font-mono text-[10px] text-black/70">Trackout: {formatCents(localBeat.trackout_lease_price)}</span>}
                {localBeat.exclusive_price && localBeat.has_exclusive && <span className="font-mono text-[10px] text-accent font-bold">Exclusive: {formatCents(localBeat.exclusive_price)}</span>}
              </div>
            </>
          )}
        </div>

        {/* Agreement Text */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 py-4 min-h-0"
        >
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-black/40" />
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">
              Agreement v{BEAT_AGREEMENT_VERSION} — scroll to read full terms
            </p>
          </div>
          <pre className="font-mono text-xs text-black/70 whitespace-pre-wrap leading-relaxed">
            {BEAT_AGREEMENT_TEXT}
          </pre>
        </div>

        {/* Sign Section */}
        <div className="p-6 border-t border-black/10 space-y-4">
          {!scrolledToBottom && (
            <p className="font-mono text-[10px] text-amber-600 uppercase tracking-wider">
              Please scroll through the full agreement before signing
            </p>
          )}

          <label className={`flex items-start gap-3 cursor-pointer ${!scrolledToBottom ? 'opacity-50 pointer-events-none' : ''}`}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={!scrolledToBottom}
              className="w-5 h-5 accent-accent mt-0.5 flex-shrink-0"
            />
            <span className="font-mono text-xs text-black/70">
              I have read and agree to the terms of this Beat Licensing & Distribution Agreement. I confirm that I own the rights to this beat and all samples are properly cleared.
            </span>
          </label>

          {error && (
            <p className="font-mono text-sm text-red-600">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleSign}
              disabled={!agreed || signing}
              className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              {signing ? 'Signing...' : 'Sign & Go Live'}
            </button>
            <button
              onClick={onClose}
              className="border border-black/20 text-black/60 font-mono text-sm uppercase tracking-wider px-6 py-3 hover:bg-black/5"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SalesTab({ sales }: { sales: Sale[] }) {
  if (sales.length === 0) {
    return (
      <div className="border-2 border-black/10 p-12 text-center">
        <ShoppingCart className="w-12 h-12 text-black/10 mx-auto mb-4" />
        <p className="font-mono text-sm text-black/70">No sales yet.</p>
      </div>
    );
  }

  const LICENSE_LABELS: Record<string, string> = {
    mp3_lease: 'MP3 Lease',
    trackout_lease: 'Trackout Lease',
    exclusive: 'Exclusive',
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-5 gap-4 px-4 py-2 border-b border-black/10">
        <span className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Date</span>
        <span className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Beat</span>
        <span className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Buyer</span>
        <span className="font-mono text-[10px] text-black/60 uppercase tracking-wider">License</span>
        <span className="font-mono text-[10px] text-black/60 uppercase tracking-wider text-right">Amount</span>
      </div>
      {sales.map((sale) => {
        const beatTitle = Array.isArray(sale.beats) ? sale.beats[0]?.title : sale.beats?.title;
        return (
          <div key={sale.id} className="grid grid-cols-5 gap-4 px-4 py-3 border-b border-black/5 hover:bg-black/[0.02]">
            <span className="font-mono text-xs text-black/70">
              {fmtStampDate(sale.created_at)}
            </span>
            <span className="font-mono text-xs font-semibold truncate">{beatTitle || 'Unknown'}</span>
            <span className="font-mono text-xs text-black/50 truncate">{sale.buyer_email}</span>
            <span className="font-mono text-xs text-black/70">{LICENSE_LABELS[sale.license_type] || sale.license_type}</span>
            <span className="font-mono text-xs font-bold text-right">{formatCents(sale.amount_paid)}</span>
          </div>
        );
      })}
    </div>
  );
}

function EarningsTab({ earnings }: { earnings: Earnings }) {
  return (
    <div>
      {/* Earnings overview */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <div className="border-2 border-accent p-6">
          <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Your Earnings ({Math.round(PRODUCER_COMMISSION * 100)}%)</p>
          <p className="text-display-sm text-accent">{formatCents(earnings.netEarnings)}</p>
        </div>
        <div className="border-2 border-black/10 p-6">
          <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Gross Sales</p>
          <p className="text-heading-lg">{formatCents(earnings.totalGross)}</p>
        </div>
        <div className="border-2 border-black/10 p-6">
          <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Platform Fee ({Math.round(PLATFORM_COMMISSION * 100)}%)</p>
          <p className="text-heading-lg text-black/60">{formatCents(earnings.platformFee)}</p>
        </div>
      </div>

      {/* Payout status */}
      <div className="border-2 border-black/10 p-6">
        <h3 className="font-mono text-sm font-bold uppercase mb-4">Payout Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Total Paid Out</p>
            <p className="font-mono text-lg font-bold text-green-600">{formatCents(earnings.totalPaid)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Pending Payout</p>
            <p className="font-mono text-lg font-bold text-accent">{formatCents(earnings.pendingPayout)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Beats / Total Leases</p>
            <p className="font-mono text-lg font-bold">{earnings.totalBeats} / {earnings.totalLeases}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
