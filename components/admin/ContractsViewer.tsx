'use client';

import { useState, useEffect, useMemo } from 'react';
import { FileText, Search, ChevronDown, ChevronUp, ShieldCheck, Handshake, Tag } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { BEAT_AGREEMENT_TEXT, BEAT_AGREEMENT_VERSION } from '@/lib/constants';
import { generateLicenseText } from '@/lib/license-templates';
import { fmtStampDate } from '@/lib/studio-time';

type SubTab = 'templates' | 'licenses' | 'producer' | 'private';

interface BeatPurchase {
  id: string;
  buyer_email: string;
  license_type: string;
  amount_paid: number;
  license_text: string | null;
  created_at: string;
  beats: { title: string; producer: string } | null;
}

interface ProducerAgreement {
  id: string;
  producer_name: string;
  beat_title: string;
  agreement_text: string | null;
  agreed_at: string;
  agreement_version: string | null;
  ip_address: string | null;
  status: string | null;
}

interface PrivateSale {
  id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  beat_title: string | null;
  license_type: string | null;
  amount: number | null;
  agreement_text: string | null;
  signed_at: string | null;
  agreement_ip: string | null;
  status: string | null;
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = (status || 'unknown').toLowerCase();
  const colors: Record<string, string> = {
    completed: 'bg-green-100 text-green-800',
    signed: 'bg-green-100 text-green-800',
    active: 'bg-green-100 text-green-800',
    agreed: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    draft: 'bg-gray-100 text-gray-600',
    expired: 'bg-red-100 text-red-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  const cls = colors[s] || 'bg-black/5 text-black/50';
  return (
    <span className={`inline-block font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${cls}`}>
      {s}
    </span>
  );
}

function formatDate(d: string | null | undefined) {
  return fmtStampDate(d, { month: 'short', day: 'numeric', year: '2-digit' }) || '--';
}

export default function ContractsViewer() {
  const [subTab, setSubTab] = useState<SubTab>('templates');
  const [loading, setLoading] = useState(true);
  const [beatPurchases, setBeatPurchases] = useState<BeatPurchase[]>([]);
  const [producerAgreements, setProducerAgreements] = useState<ProducerAgreement[]>([]);
  const [privateSales, setPrivateSales] = useState<PrivateSale[]>([]);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/admin/contracts');
        const data = await res.json();
        setBeatPurchases(data.beatPurchases || []);
        setProducerAgreements(data.producerAgreements || []);
        setPrivateSales(data.privateSales || []);
      } catch {
        // silent
      }
      setLoading(false);
    }
    load();
  }, []);

  const q = search.toLowerCase().trim();

  const filteredLicenses = useMemo(() => {
    if (!q) return beatPurchases;
    return beatPurchases.filter(p =>
      p.buyer_email?.toLowerCase().includes(q) ||
      p.license_type?.toLowerCase().includes(q) ||
      p.beats?.title?.toLowerCase().includes(q) ||
      p.beats?.producer?.toLowerCase().includes(q)
    );
  }, [beatPurchases, q]);

  const filteredProducer = useMemo(() => {
    if (!q) return producerAgreements;
    return producerAgreements.filter(a =>
      a.producer_name?.toLowerCase().includes(q) ||
      a.beat_title?.toLowerCase().includes(q) ||
      a.status?.toLowerCase().includes(q)
    );
  }, [producerAgreements, q]);

  const filteredPrivate = useMemo(() => {
    if (!q) return privateSales;
    return privateSales.filter(s =>
      s.buyer_name?.toLowerCase().includes(q) ||
      s.buyer_email?.toLowerCase().includes(q) ||
      s.beat_title?.toLowerCase().includes(q) ||
      s.license_type?.toLowerCase().includes(q)
    );
  }, [privateSales, q]);

  const totalContracts = beatPurchases.length + producerAgreements.length + privateSales.length;

  // Recent activity: contracts in last 7 days
  const recentCount = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentPurchases = beatPurchases.filter(p => new Date(p.created_at).getTime() > sevenDaysAgo).length;
    const recentAgreements = producerAgreements.filter(a => new Date(a.agreed_at).getTime() > sevenDaysAgo).length;
    const recentPrivate = privateSales.filter(s => s.signed_at && new Date(s.signed_at).getTime() > sevenDaysAgo).length;
    return recentPurchases + recentAgreements + recentPrivate;
  }, [beatPurchases, producerAgreements, privateSales]);

  function toggleExpand(id: string) {
    setExpandedId(prev => prev === id ? null : id);
  }

  // Generate sample license previews for the templates tab
  const sampleLicenses = {
    mp3_lease: generateLicenseText({ buyerName: 'John Doe', buyerEmail: 'john@example.com', beatTitle: 'Summer Vibes', producerName: 'DJ Producer', licenseType: 'mp3_lease', amountPaid: 2999, purchaseDate: '2026-04-03', purchaseId: 'SAMPLE-MP3-001' }),
    trackout_lease: generateLicenseText({ buyerName: 'John Doe', buyerEmail: 'john@example.com', beatTitle: 'Summer Vibes', producerName: 'DJ Producer', licenseType: 'trackout_lease', amountPaid: 7499, purchaseDate: '2026-04-03', purchaseId: 'SAMPLE-TRACK-001' }),
    exclusive: generateLicenseText({ buyerName: 'John Doe', buyerEmail: 'john@example.com', beatTitle: 'Summer Vibes', producerName: 'DJ Producer', licenseType: 'exclusive', amountPaid: 40000, purchaseDate: '2026-04-03', purchaseId: 'SAMPLE-EXCL-001' }),
  };

  const subTabs: { key: SubTab; label: string; count: number; icon: typeof FileText }[] = [
    { key: 'templates', label: 'Contract Templates', count: 4, icon: FileText },
    { key: 'licenses', label: 'Beat Licenses', count: beatPurchases.length, icon: Tag },
    { key: 'producer', label: 'Producer Agreements', count: producerAgreements.length, icon: Handshake },
    { key: 'private', label: 'Private Sales', count: privateSales.length, icon: ShieldCheck },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-heading-sm">CONTRACTS & AGREEMENTS</h2>
        <p className="font-mono text-xs text-black/40 mt-1">View all license agreements, producer contracts, and private sale agreements.</p>
      </div>

      {loading ? (
        <p className="font-mono text-sm text-black/40">Loading contracts...</p>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="border-2 border-accent p-4">
              <FileText className="w-4 h-4 text-accent mb-2" />
              <p className="font-heading text-xl text-accent">{totalContracts}</p>
              <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider">Total Contracts</p>
            </div>
            <div className="border-2 border-black/10 p-4">
              <Tag className="w-4 h-4 text-black/30 mb-2" />
              <p className="font-heading text-xl">{beatPurchases.length}</p>
              <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider">Beat Licenses</p>
            </div>
            <div className="border-2 border-black/10 p-4">
              <Handshake className="w-4 h-4 text-black/30 mb-2" />
              <p className="font-heading text-xl">{producerAgreements.length}</p>
              <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider">Producer Agreements</p>
            </div>
            <div className="border-2 border-black/10 p-4">
              <ShieldCheck className="w-4 h-4 text-black/30 mb-2" />
              <p className="font-heading text-xl">{recentCount}</p>
              <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider">Last 7 Days</p>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-0 border-b border-black/10">
            {subTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => { setSubTab(t.key); setExpandedId(null); }}
                className={`font-mono text-xs font-semibold uppercase tracking-wider px-4 py-3 border-b-2 transition-colors inline-flex items-center gap-2 ${
                  subTab === t.key ? 'border-accent text-black' : 'border-transparent text-black/40 hover:text-black/70'
                }`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
                <span className={`text-[10px] px-1.5 py-0.5 ${subTab === t.key ? 'bg-accent/10 text-accent' : 'bg-black/5'}`}>{t.count}</span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-black/20 pl-10 pr-4 py-2.5 font-mono text-sm focus:border-accent focus:outline-none"
              placeholder="Search by name, email, beat title..."
            />
          </div>

          {/* Contract Templates Tab */}
          {subTab === 'templates' && (
            <div className="space-y-6">
              <p className="font-mono text-xs text-black/50">These are the actual contract templates that buyers and producers sign. Click to expand each one.</p>

              {/* Producer Agreement */}
              <div className="border-2 border-black/10">
                <button onClick={() => setExpandedId(expandedId === 'tpl-producer' ? null : 'tpl-producer')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-black/[0.02]">
                  <div>
                    <p className="font-mono text-sm font-bold">Producer Agreement (v{BEAT_AGREEMENT_VERSION})</p>
                    <p className="font-mono text-[10px] text-black/40 mt-0.5">Signed by producers when their beat is approved to go live on the store</p>
                  </div>
                  {expandedId === 'tpl-producer' ? <ChevronUp className="w-4 h-4 text-black/30" /> : <ChevronDown className="w-4 h-4 text-black/30" />}
                </button>
                {expandedId === 'tpl-producer' && (
                  <div className="border-t border-black/10 bg-black/[0.02] p-4">
                    <pre className="font-mono text-xs text-black/70 whitespace-pre-wrap max-h-[600px] overflow-y-auto border border-black/10 bg-white p-4">{BEAT_AGREEMENT_TEXT}</pre>
                  </div>
                )}
              </div>

              {/* MP3 Lease License */}
              <div className="border-2 border-black/10">
                <button onClick={() => setExpandedId(expandedId === 'tpl-mp3' ? null : 'tpl-mp3')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-black/[0.02]">
                  <div>
                    <p className="font-mono text-sm font-bold">MP3 Lease License</p>
                    <p className="font-mono text-[10px] text-black/40 mt-0.5">Non-exclusive MP3 license — 500K streams, 5K sales, 1 music video</p>
                  </div>
                  {expandedId === 'tpl-mp3' ? <ChevronUp className="w-4 h-4 text-black/30" /> : <ChevronDown className="w-4 h-4 text-black/30" />}
                </button>
                {expandedId === 'tpl-mp3' && (
                  <div className="border-t border-black/10 bg-black/[0.02] p-4">
                    <p className="font-mono text-[10px] text-accent mb-2 uppercase tracking-wider">Sample preview with placeholder data</p>
                    <pre className="font-mono text-xs text-black/70 whitespace-pre-wrap max-h-[600px] overflow-y-auto border border-black/10 bg-white p-4">{sampleLicenses.mp3_lease}</pre>
                  </div>
                )}
              </div>

              {/* Trackout Lease License */}
              <div className="border-2 border-black/10">
                <button onClick={() => setExpandedId(expandedId === 'tpl-trackout' ? null : 'tpl-trackout')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-black/[0.02]">
                  <div>
                    <p className="font-mono text-sm font-bold">Trackout Lease License</p>
                    <p className="font-mono text-[10px] text-black/40 mt-0.5">Non-exclusive stems license — 1M streams, 10K sales, monetized video</p>
                  </div>
                  {expandedId === 'tpl-trackout' ? <ChevronUp className="w-4 h-4 text-black/30" /> : <ChevronDown className="w-4 h-4 text-black/30" />}
                </button>
                {expandedId === 'tpl-trackout' && (
                  <div className="border-t border-black/10 bg-black/[0.02] p-4">
                    <p className="font-mono text-[10px] text-accent mb-2 uppercase tracking-wider">Sample preview with placeholder data</p>
                    <pre className="font-mono text-xs text-black/70 whitespace-pre-wrap max-h-[600px] overflow-y-auto border border-black/10 bg-white p-4">{sampleLicenses.trackout_lease}</pre>
                  </div>
                )}
              </div>

              {/* Exclusive License */}
              <div className="border-2 border-accent/30">
                <button onClick={() => setExpandedId(expandedId === 'tpl-exclusive' ? null : 'tpl-exclusive')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-accent/5">
                  <div>
                    <p className="font-mono text-sm font-bold">Exclusive Rights License</p>
                    <p className="font-mono text-[10px] text-black/40 mt-0.5">Full ownership — unlimited everything, transferable, beat removed from store</p>
                  </div>
                  {expandedId === 'tpl-exclusive' ? <ChevronUp className="w-4 h-4 text-black/30" /> : <ChevronDown className="w-4 h-4 text-black/30" />}
                </button>
                {expandedId === 'tpl-exclusive' && (
                  <div className="border-t border-black/10 bg-black/[0.02] p-4">
                    <p className="font-mono text-[10px] text-accent mb-2 uppercase tracking-wider">Sample preview with placeholder data</p>
                    <pre className="font-mono text-xs text-black/70 whitespace-pre-wrap max-h-[600px] overflow-y-auto border border-black/10 bg-white p-4">{sampleLicenses.exclusive}</pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Beat Licenses Tab */}
          {subTab === 'licenses' && (
            <div>
              <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3">Beat License Agreements ({filteredLicenses.length})</h3>
              {filteredLicenses.length === 0 ? (
                <p className="font-mono text-xs text-black/30 border border-black/10 p-6 text-center">No beat license agreements found.</p>
              ) : (
                <div className="space-y-2">
                  {filteredLicenses.map(p => (
                    <div key={p.id} className="border border-black/10">
                      <button
                        onClick={() => toggleExpand(p.id)}
                        className="w-full p-4 text-left hover:bg-black/[0.02] transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-mono text-sm font-bold truncate">{p.beats?.title || 'Unknown Beat'}</span>
                              <span className="font-mono text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 uppercase font-bold">{p.license_type}</span>
                              <StatusBadge status="completed" />
                            </div>
                            <div className="font-mono text-xs text-black/50 space-x-3">
                              <span>Buyer: {p.buyer_email}</span>
                              {p.beats?.producer && <span>Producer: {p.beats.producer}</span>}
                              <span>{formatDate(p.created_at)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <p className="font-mono text-sm font-bold">{formatCents(p.amount_paid)}</p>
                            {expandedId === p.id ? <ChevronUp className="w-4 h-4 text-black/30" /> : <ChevronDown className="w-4 h-4 text-black/30" />}
                          </div>
                        </div>
                      </button>
                      {expandedId === p.id && p.license_text && (
                        <div className="border-t border-black/10 p-4 bg-black/[0.02]">
                          <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-2">Full License Agreement</p>
                          <pre className="font-mono text-xs text-black/70 whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed">{p.license_text}</pre>
                        </div>
                      )}
                      {expandedId === p.id && !p.license_text && (
                        <div className="border-t border-black/10 p-4 bg-black/[0.02]">
                          <p className="font-mono text-xs text-black/30 italic">No license text recorded for this purchase.</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Producer Agreements Tab */}
          {subTab === 'producer' && (
            <div>
              <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3">Producer Agreements ({filteredProducer.length})</h3>
              {filteredProducer.length === 0 ? (
                <p className="font-mono text-xs text-black/30 border border-black/10 p-6 text-center">No producer agreements found.</p>
              ) : (
                <div className="space-y-2">
                  {filteredProducer.map(a => (
                    <div key={a.id} className="border border-black/10">
                      <button
                        onClick={() => toggleExpand(a.id)}
                        className="w-full p-4 text-left hover:bg-black/[0.02] transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-mono text-sm font-bold truncate">{a.producer_name}</span>
                              {a.beat_title && <span className="font-mono text-[10px] bg-black/5 px-1.5 py-0.5">{a.beat_title}</span>}
                              <StatusBadge status={a.status} />
                            </div>
                            <div className="font-mono text-xs text-black/50 space-x-3">
                              <span>{formatDate(a.agreed_at)}</span>
                              {a.agreement_version && <span>v{a.agreement_version}</span>}
                              {a.ip_address && <span>IP: {a.ip_address}</span>}
                            </div>
                          </div>
                          <div className="flex-shrink-0">
                            {expandedId === a.id ? <ChevronUp className="w-4 h-4 text-black/30" /> : <ChevronDown className="w-4 h-4 text-black/30" />}
                          </div>
                        </div>
                      </button>
                      {expandedId === a.id && a.agreement_text && (
                        <div className="border-t border-black/10 p-4 bg-black/[0.02]">
                          <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-2">Full Producer Agreement</p>
                          <pre className="font-mono text-xs text-black/70 whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed">{a.agreement_text}</pre>
                        </div>
                      )}
                      {expandedId === a.id && !a.agreement_text && (
                        <div className="border-t border-black/10 p-4 bg-black/[0.02]">
                          <p className="font-mono text-xs text-black/30 italic">No agreement text recorded.</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Private Sales Tab */}
          {subTab === 'private' && (
            <div>
              <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3">Private Sale Agreements ({filteredPrivate.length})</h3>
              {filteredPrivate.length === 0 ? (
                <p className="font-mono text-xs text-black/30 border border-black/10 p-6 text-center">No private sale agreements found.</p>
              ) : (
                <div className="space-y-2">
                  {filteredPrivate.map(s => (
                    <div key={s.id} className="border border-black/10">
                      <button
                        onClick={() => toggleExpand(s.id)}
                        className="w-full p-4 text-left hover:bg-black/[0.02] transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-mono text-sm font-bold truncate">{s.buyer_name || s.buyer_email || 'Unknown Buyer'}</span>
                              {s.beat_title && <span className="font-mono text-[10px] bg-black/5 px-1.5 py-0.5">{s.beat_title}</span>}
                              {s.license_type && <span className="font-mono text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 uppercase font-bold">{s.license_type}</span>}
                              <StatusBadge status={s.status} />
                            </div>
                            <div className="font-mono text-xs text-black/50 space-x-3">
                              {s.buyer_email && <span>{s.buyer_email}</span>}
                              <span>{formatDate(s.signed_at)}</span>
                              {s.agreement_ip && <span>IP: {s.agreement_ip}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            {s.amount != null && <p className="font-mono text-sm font-bold">{formatCents(s.amount)}</p>}
                            {expandedId === s.id ? <ChevronUp className="w-4 h-4 text-black/30" /> : <ChevronDown className="w-4 h-4 text-black/30" />}
                          </div>
                        </div>
                      </button>
                      {expandedId === s.id && s.agreement_text && (
                        <div className="border-t border-black/10 p-4 bg-black/[0.02]">
                          <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-2">Full Sale Agreement</p>
                          <pre className="font-mono text-xs text-black/70 whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed">{s.agreement_text}</pre>
                        </div>
                      )}
                      {expandedId === s.id && !s.agreement_text && (
                        <div className="border-t border-black/10 p-4 bg-black/[0.02]">
                          <p className="font-mono text-xs text-black/30 italic">No agreement text recorded for this sale.</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
