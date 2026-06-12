'use client';

import { useState, useEffect } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface DownloadLink {
  url: string;
  fileName: string;
}

export default function BeatSuccessClient() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const beatId = searchParams.get('beat');
  const [downloads, setDownloads] = useState<DownloadLink[]>([]);
  const [license, setLicense] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadsRemaining, setDownloadsRemaining] = useState<number | null>(null);
  const [purchaseId, setPurchaseId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }

    // Fetch purchase by checkout session to get download links
    fetch(`/api/beats/purchase-by-session?sessionId=${sessionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.purchaseId) {
          setPurchaseId(data.purchaseId);

          // Fetch downloads
          fetch(`/api/beats/download?purchaseId=${data.purchaseId}`)
            .then((r) => r.json())
            .then((dlData) => {
              setDownloads(dlData.downloads || []);
              setDownloadsRemaining(dlData.downloadsRemaining ?? null);
            });

          // Fetch license
          fetch(`/api/beats/license?purchaseId=${data.purchaseId}`)
            .then((r) => r.json())
            .then((licData) => setLicense(licData.license || null));
        }
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="w-8 h-8 text-accent mx-auto animate-spin mb-4" />
        <p className="font-mono text-sm text-black/40">Loading your purchase...</p>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="text-center py-12">
        <p className="font-mono text-sm text-black/50 mb-4">No purchase session found.</p>
        <Link href="/beats" className="font-mono text-sm text-accent hover:underline no-underline">
          Browse beats &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Download Files */}
      <div>
        <h2 className="text-heading-md mb-4 flex items-center gap-2">
          <Download className="w-5 h-5 text-accent" /> Downloads
        </h2>
        {downloads.length > 0 ? (
          <div className="space-y-2">
            {downloads.map((dl, i) => (
              <a
                key={i}
                href={dl.url}
                download={dl.fileName}
                className="border-2 border-black/10 p-4 flex items-center justify-between gap-4 hover:border-accent transition-colors no-underline block"
              >
                <span className="font-mono text-sm font-semibold truncate">{dl.fileName}</span>
                <Download className="w-5 h-5 text-accent flex-shrink-0" />
              </a>
            ))}
            {downloadsRemaining !== null && (
              <p className="font-mono text-[10px] text-black/30 mt-2">
                {downloadsRemaining} download{downloadsRemaining !== 1 ? 's' : ''} remaining
              </p>
            )}
          </div>
        ) : (
          <p className="font-mono text-sm text-black/40">
            Download links are being prepared. Refresh the page if they don&apos;t appear.
          </p>
        )}
      </div>

      {/* License Agreement */}
      {license && (
        <div>
          <h2 className="text-heading-md mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-accent" /> License Agreement
          </h2>
          <pre className="border-2 border-black/10 p-6 font-mono text-xs text-black/70 whitespace-pre-wrap overflow-x-auto max-h-96 overflow-y-auto">
            {license}
          </pre>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3 pt-4 border-t border-black/10">
        <Link
          href="/beats"
          className="bg-black text-white font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-black/80 transition-colors no-underline"
        >
          Browse More Beats
        </Link>
        <Link
          href="/dashboard"
          className="border-2 border-black text-black font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-black hover:text-white transition-colors no-underline"
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}
