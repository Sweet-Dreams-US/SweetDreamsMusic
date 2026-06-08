import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FileAudio, ArrowLeft } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import DashboardNav from '@/components/layout/DashboardNav';
import FilesFilter from '@/components/dashboard/FilesFilter';

export const metadata: Metadata = { title: 'My Files' };

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

  // Generate signed download URLs. Each call is isolated in a try/catch: a single
  // transient storage error must NOT 500 the whole page (supabase-js re-throws
  // non-StorageErrors like network/timeout from createSignedUrl).
  const filesWithUrls = await Promise.all(
    (deliverables || []).map(async (file) => {
      const isPublic = publicDeliverableIds.has(file.id);
      if (!file.file_path) return { ...file, downloadUrl: null, isPublic };
      try {
        const { data } = await serviceClient.storage
          .from('client-audio-files')
          .createSignedUrl(file.file_path, 3600, { download: file.file_name || true });
        return { ...file, downloadUrl: data?.signedUrl || null, isPublic };
      } catch (e) {
        console.error('[files] signed URL failed for', file.file_path, e);
        return { ...file, downloadUrl: null, isPublic };
      }
    })
  );

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
            // FilesFilter is a Client Component that renders the list itself —
            // we pass plain serializable data (downloadUrl + isPublic resolved),
            // NOT a render-prop function (which can't cross the RSC boundary).
            <FilesFilter files={filesWithUrls} profileSlug={profileSlug} />
          )}
        </div>
      </section>
    </>
  );
}
