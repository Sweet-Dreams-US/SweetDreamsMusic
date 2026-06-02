'use client';

import { useState, useEffect } from 'react';
import { Music, Download, FileText, ChevronDown, ChevronUp, ShoppingBag } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { fmtStampDate } from '@/lib/studio-time';
import { BEAT_LICENSES } from '@/lib/constants';
import Link from 'next/link';

interface Purchase {
  id: string;
  beat_id: string | null;
  license_type: string;
  amount_paid: number;
  download_count: number;
  license_text: string | null;
  payment_method: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  lease_expires_at: string | null;
  renewal_blocked: boolean;
  created_at: string;
  beats: {
    id: string;
    title: string;
    producer: string;
    genre: string | null;
    cover_image_url: string | null;
    preview_url: string | null;
    trackout_lease_price: number | null;
    exclusive_price: number | null;
    has_exclusive: boolean;
    status: string;
  } | null;
}

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLicense, setExpandedLicense] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [renewing, setRenewing] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboard/purchases')
      .then(r => r.json())
      .then(d => setPurchases(d.purchases || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleDownload(purchaseId: string) {
    setDownloading(purchaseId);
    try {
      const res = await fetch(`/api/beats/download?purchaseId=${purchaseId}`);
      const data = await res.json();
      if (data.downloads && data.downloads.length > 0) {
        for (const file of data.downloads) {
          const link = document.createElement('a');
          link.href = file.url;
          link.download = file.fileName;
          link.click();
        }
        // Update local download count
        setPurchases(prev => prev.map(p =>
          p.id === purchaseId ? { ...p, download_count: p.download_count + 1 } : p
        ));
      } else {
        alert(data.error || 'Download not available');
      }
    } catch {
      alert('Download failed');
    }
    setDownloading(null);
  }

  async function viewLicense(purchaseId: string) {
    if (expandedLicense === purchaseId) {
      setExpandedLicense(null);
      return;
    }

    // If license_text is already loaded, just toggle
    const purchase = purchases.find(p => p.id === purchaseId);
    if (purchase?.license_text) {
      setExpandedLicense(purchaseId);
      return;
    }

    // Fetch license from API
    try {
      const res = await fetch(`/api/beats/license?purchaseId=${purchaseId}`);
      const data = await res.json();
      if (data.license) {
        setPurchases(prev => prev.map(p =>
          p.id === purchaseId ? { ...p, license_text: data.license } : p
        ));
      }
    } catch { /* */ }
    setExpandedLicense(purchaseId);
  }

  async function handleRenew(purchaseId: string) {
    setRenewing(purchaseId);
    try {
      const res = await fetch('/api/beats/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseId }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || 'Renewal failed');
    } catch { alert('Renewal failed'); }
    setRenewing(null);
  }

  async function handleUpgrade(purchaseId: string, targetLicenseType: string) {
    setUpgrading(purchaseId);
    try {
      const res = await fetch('/api/beats/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseId, targetLicenseType }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || 'Upgrade failed');
    } catch { alert('Upgrade failed'); }
    setUpgrading(null);
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <p className="font-mono text-sm text-black/70">Loading purchases...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-heading-lg">MY PURCHASES</h1>
        <Link href="/beats" className="font-mono text-xs font-bold text-accent hover:underline">
          Browse Beats
        </Link>
      </div>

      {purchases.length === 0 ? (
        <div className="border-2 border-black/10 p-12 text-center">
          <ShoppingBag className="w-12 h-12 text-black/10 mx-auto mb-4" />
          <p className="font-mono text-sm text-black/70 mb-4">No purchases yet</p>
          <Link href="/beats" className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-6 py-3 hover:bg-accent/90 inline-block">
            Browse Beat Store
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="font-mono text-xs text-black/60">{purchases.length} purchase{purchases.length !== 1 ? 's' : ''}</p>

          {purchases.map(purchase => {
            const beat = Array.isArray(purchase.beats) ? purchase.beats[0] : purchase.beats;
            const license = BEAT_LICENSES[purchase.license_type as keyof typeof BEAT_LICENSES];
            const isExpanded = expandedLicense === purchase.id;
            const isRevoked = !!purchase.revoked_at;
            const isExpired = !!purchase.lease_expires_at && new Date(purchase.lease_expires_at) < new Date();
            const isExpiringSoon = !!purchase.lease_expires_at && !isExpired && new Date(purchase.lease_expires_at) < new Date(Date.now() + 30 * 86400000);
            const canRenew = !isRevoked && !purchase.renewal_blocked && purchase.license_type !== 'exclusive';
            const canDownload = !isRevoked && !isExpired;
            const beatData = beat as { trackout_lease_price?: number | null; exclusive_price?: number | null; has_exclusive?: boolean; status?: string } | null;
            const canUpgradeToTrackout = purchase.license_type === 'mp3_lease' && beatData?.trackout_lease_price && beatData?.status !== 'sold_exclusive';
            const canUpgradeToExclusive = purchase.license_type !== 'exclusive' && beatData?.exclusive_price && beatData?.has_exclusive && beatData?.status !== 'sold_exclusive';

            return (
              <div key={purchase.id} className={`border-2 overflow-hidden ${isRevoked ? 'border-red-200 bg-red-50/30' : isExpired ? 'border-amber-200 bg-amber-50/30' : 'border-black/10'}`}>
                {/* Revoked banner */}
                {purchase.revoked_at && (
                  <div className="bg-red-100 border-b border-red-200 px-4 py-2">
                    <p className="font-mono text-xs font-bold text-red-700 uppercase">
                      Lease Revoked — Exclusive rights purchased
                    </p>
                    <p className="font-mono text-[10px] text-red-600">
                      Revoked on {fmtStampDate(purchase.revoked_at, { month: 'short', day: 'numeric', year: 'numeric' })}. Downloads are no longer available.
                    </p>
                  </div>
                )}

                {/* Expired banner */}
                {isExpired && !isRevoked && (
                  <div className="bg-amber-100 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
                    <div>
                      <p className="font-mono text-xs font-bold text-amber-700 uppercase">
                        Lease Expired
                      </p>
                      <p className="font-mono text-[10px] text-amber-600">
                        Expired {fmtStampDate(purchase.lease_expires_at, { month: 'short', day: 'numeric', year: 'numeric' })}. {canRenew ? 'Renew to continue using this beat.' : 'Cannot renew — exclusive was purchased.'}
                      </p>
                    </div>
                    {canRenew && (
                      <button onClick={() => handleRenew(purchase.id)} disabled={renewing === purchase.id}
                        className="bg-amber-600 text-white font-mono text-[10px] font-bold uppercase px-3 py-1.5 hover:bg-amber-700 disabled:opacity-50 flex-shrink-0">
                        {renewing === purchase.id ? '...' : 'Renew (25% off)'}
                      </button>
                    )}
                  </div>
                )}

                {/* Expiring soon banner */}
                {isExpiringSoon && !isRevoked && (
                  <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 flex items-center justify-between">
                    <p className="font-mono text-[10px] text-yellow-700">
                      Expires {fmtStampDate(purchase.lease_expires_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                    {canRenew && (
                      <button onClick={() => handleRenew(purchase.id)} disabled={renewing === purchase.id}
                        className="font-mono text-[10px] text-yellow-700 font-bold uppercase hover:underline disabled:opacity-50">
                        Renew early (25% off)
                      </button>
                    )}
                  </div>
                )}

                {/* Grandfathered banner */}
                {purchase.renewal_blocked && !isRevoked && !isExpired && (
                  <div className="bg-blue-50 border-b border-blue-200 px-4 py-2">
                    <p className="font-mono text-[10px] text-blue-700">
                      Exclusive rights purchased by another buyer. Your lease is valid until {purchase.lease_expires_at ? fmtStampDate(purchase.lease_expires_at, { month: 'short', day: 'numeric', year: 'numeric' }) : 'its term'} but cannot be renewed.
                    </p>
                  </div>
                )}

                <div className="p-4 flex items-start gap-4">
                  {/* Cover art */}
                  <div className={`w-16 h-16 bg-black/5 flex-shrink-0 flex items-center justify-center overflow-hidden ${isRevoked ? 'opacity-50' : ''}`}>
                    {beat?.cover_image_url ? (
                      <img src={beat.cover_image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-6 h-6 text-black/20" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className={`font-mono text-sm font-bold truncate ${isRevoked ? 'text-black/40 line-through' : ''}`}>{beat?.title || 'Beat'}</p>
                    <p className="font-mono text-xs text-black/70">
                      {beat?.producer || 'Producer'}
                      {beat?.genre && ` · ${beat.genre}`}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {isRevoked ? (
                        <span className="bg-red-100 text-red-700 font-mono text-[10px] font-bold uppercase px-2 py-0.5">
                          Revoked
                        </span>
                      ) : (
                        <span className="bg-accent/20 text-accent font-mono text-[10px] font-bold uppercase px-2 py-0.5">
                          {license?.name || purchase.license_type}
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-black/60">
                        {formatCents(purchase.amount_paid)}
                      </span>
                      <span className="font-mono text-[10px] text-black/60">
                        {fmtStampDate(purchase.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      {canDownload && (
                        <span className="font-mono text-[10px] text-black/60">
                          {purchase.download_count}/10 downloads
                        </span>
                      )}
                      {purchase.lease_expires_at && !isExpired && !isExpiringSoon && !isRevoked && (
                        <span className="font-mono text-[10px] text-black/40">
                          Expires {fmtStampDate(purchase.lease_expires_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {!canDownload ? (
                      <span className="font-mono text-[10px] text-red-500 font-bold uppercase px-3 py-2">
                        {isExpired ? 'Expired' : 'No Downloads'}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleDownload(purchase.id)}
                        disabled={downloading === purchase.id || purchase.download_count >= 10}
                        className="bg-accent text-black font-mono text-[10px] font-bold uppercase px-3 py-2 hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" />
                        {downloading === purchase.id ? 'Loading...' : purchase.download_count >= 10 ? 'Limit Reached' : 'Download'}
                      </button>
                    )}
                    {/* Upgrade buttons */}
                    {canUpgradeToTrackout && !isRevoked && (
                      <button onClick={() => handleUpgrade(purchase.id, 'trackout_lease')} disabled={upgrading === purchase.id}
                        className="border border-accent text-accent font-mono text-[10px] font-bold uppercase px-3 py-1.5 hover:bg-accent/10 disabled:opacity-50">
                        {upgrading === purchase.id ? '...' : 'Upgrade to Trackout'}
                      </button>
                    )}
                    {canUpgradeToExclusive && !isRevoked && (
                      <button onClick={() => handleUpgrade(purchase.id, 'exclusive')} disabled={upgrading === purchase.id}
                        className="border border-accent text-accent font-mono text-[10px] font-bold uppercase px-3 py-1.5 hover:bg-accent/10 disabled:opacity-50">
                        {upgrading === purchase.id ? '...' : 'Buy Exclusive'}
                      </button>
                    )}
                    <button
                      onClick={() => viewLicense(purchase.id)}
                      className="border border-black/20 text-black font-mono text-[10px] font-bold uppercase px-3 py-2 hover:border-black/40 inline-flex items-center gap-1"
                    >
                      <FileText className="w-3 h-3" />
                      License
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                {/* Expanded license */}
                {isExpanded && (
                  <div className="border-t border-black/10 bg-black/[0.02] p-4">
                    <h4 className="font-mono text-xs font-bold uppercase tracking-wider mb-3">License Agreement</h4>
                    <pre className="font-mono text-xs text-black/70 whitespace-pre-wrap max-h-96 overflow-y-auto border border-black/10 bg-white p-4">
                      {purchase.license_text || 'Loading license...'}
                    </pre>
                    <p className="font-mono text-[10px] text-black/60 mt-2">
                      Purchase ID: {purchase.id} · This license is stored in your account and can be accessed at any time.
                    </p>
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
