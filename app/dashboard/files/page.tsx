import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FileAudio, Download, ArrowLeft } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { fmtStampDate } from '@/lib/studio-time';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import DashboardNav from '@/components/layout/DashboardNav';
import FileShowcaseToggle from '@/components/dashboard/FileShowcaseToggle';
import FilesFilter from '@/components/dashboard/FilesFilter';

export const metadata: Metadata = { title: 'My Files' };

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function FilesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const serviceClient = createServiceClient();

  // Fetch ALL deliverables for this user (no limit)
  const { data: deliverables } = await supabase
    .from('deliverables')
    .select('id, file_name, display_name, file_path, file_type, file_size, uploaded_by_name, description, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  // Fetch showcase items to know which are public
  const { data: showcaseItems } = await serviceClient
    .from('profile_audio_showcase')
    .select('deliverable_id, is_public')
    .eq('user_id', user.id);

  const publicDeliverableIds = new Set(
    (showcaseItems || []).filter(s => s.is_public).map(s => s.deliverable_id)
  );

  // Generate signed download URLs
  const filesWithUrls = await Promise.all(
    (deliverables || []).map(async (file) => {
      if (file.file_path) {
        const { data } = await serviceClient.storage
          .from('client-audio-files')
          .createSignedUrl(file.file_path, 3600, { download: file.file_name || true });
        return { ...file, downloadUrl: data?.signedUrl || null, isPublic: publicDeliverableIds.has(file.id) };
      }
      return { ...file, downloadUrl: null, isPublic: publicDeliverableIds.has(file.id) };
    })
  );

  // Group files by date
  const filesByDate: Record<string, typeof filesWithUrls> = {};
  filesWithUrls.forEach(file => {
    const dateKey = fmtStampDate(file.created_at, { month: 'long', day: 'numeric', year: 'numeric' });
    if (!filesByDate[dateKey]) filesByDate[dateKey] = [];
    filesByDate[dateKey].push(file);
  });

  const profileSlug = user.profile?.public_profile_slug || undefined;

  return (
    <>
      <DashboardNav
        role={user.role}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={profileSlug}
      />

      <section className="bg-white text-black py-8 sm:py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-heading-lg flex items-center gap-3">
                <FileAudio className="w-7 h-7 text-accent" />
                MY FILES
              </h2>
              <p className="font-mono text-xs text-black/60 mt-2">
                All files from your sessions. Toggle the switch to share a track on your public profile.
              </p>
            </div>
            <Link href="/dashboard" className="font-mono text-xs text-accent hover:underline inline-flex items-center gap-1 no-underline">
              <ArrowLeft className="w-3 h-3" /> Dashboard
            </Link>
          </div>

          {filesWithUrls.length === 0 ? (
            <div className="border-2 border-black/10 p-12 text-center">
              <FileAudio className="w-10 h-10 text-black/10 mx-auto mb-4" />
              <p className="font-mono text-sm text-black/70 mb-2">No files yet</p>
              <p className="font-mono text-xs text-black/60">Files from your recording sessions will appear here for download.</p>
            </div>
          ) : (
            <FilesFilter files={filesWithUrls}>
              {(filtered) => {
                // Build a map of download URLs and public status by ID
                const urlMap = new Map(filesWithUrls.map(f => [f.id, { downloadUrl: f.downloadUrl, isPublic: f.isPublic }]));

                // Group filtered files by date
                const grouped: Record<string, typeof filtered> = {};
                filtered.forEach(file => {
                  const dateKey = fmtStampDate(file.created_at, { month: 'long', day: 'numeric', year: 'numeric' });
                  if (!grouped[dateKey]) grouped[dateKey] = [];
                  grouped[dateKey].push(file);
                });

                if (filtered.length === 0) {
                  return (
                    <div className="border-2 border-black/10 p-8 text-center">
                      <p className="font-mono text-sm text-black/70">No files match your search</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-8">
                    {Object.entries(grouped).map(([date, files]) => (
                      <div key={date}>
                        <h3 className="font-mono text-xs text-black/60 uppercase tracking-wider mb-3 border-b border-black/10 pb-2">
                          {date} — {files.length} file{files.length > 1 ? 's' : ''}
                        </h3>
                        <div className="space-y-2">
                          {files.map(file => {
                            const extra = urlMap.get(file.id);
                            const downloadUrl = (extra as { downloadUrl?: string })?.downloadUrl;
                            const isPublic = (extra as { isPublic?: boolean })?.isPublic || false;
                            return (
                              <div key={file.id} className="border-2 border-black/10 p-4 hover:border-black/30 transition-colors">
                                <div className="flex items-center justify-between gap-4">
                                  <div className="min-w-0 flex-1">
                                    <p className="font-mono text-sm font-bold truncate">
                                      {file.display_name || file.file_name}
                                    </p>
                                    <div className="font-mono text-xs text-black/60 mt-1 flex items-center gap-3 flex-wrap">
                                      <span>by {file.uploaded_by_name}</span>
                                      <span className="uppercase">{file.file_type?.split('/')[1] || 'file'}</span>
                                      {file.file_size > 0 && <span>{formatFileSize(file.file_size)}</span>}
                                    </div>
                                    {file.description && (
                                      <p className="font-mono text-[10px] text-black/60 mt-1">{file.description}</p>
                                    )}
                                  </div>
                                  {downloadUrl ? (
                                    <a
                                      href={downloadUrl}
                                      download={file.file_name}
                                      className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-accent/90 transition-colors inline-flex items-center gap-2 flex-shrink-0 no-underline"
                                    >
                                      <Download className="w-4 h-4" /> Download
                                    </a>
                                  ) : (
                                    <span className="font-mono text-xs text-black/60">Unavailable</span>
                                  )}
                                </div>
                                {file.file_type?.startsWith('audio/') && (
                                  <div className="mt-3 pt-3 border-t border-black/5">
                                    <FileShowcaseToggle
                                      deliverableId={file.id}
                                      initialEnabled={isPublic}
                                      profileSlug={profileSlug}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }}
            </FilesFilter>
          )}
        </div>
      </section>
    </>
  );
}
