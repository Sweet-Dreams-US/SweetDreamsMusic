import { createClient } from '@/lib/supabase/server';
import { getUserRole } from '@/lib/utils';
import { SUPER_ADMINS, type UserRole } from '@/lib/constants';

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  is_producer: boolean;
  producer_name: string | null;
  profile: {
    id: string;
    display_name: string;
    public_profile_slug: string;
    profile_picture_url: string | null;
  } | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !user.email) return null;

  // Fetch profile including role
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, display_name, public_profile_slug, profile_picture_url, role, is_producer, producer_name')
    .eq('user_id', user.id)
    .single();

  if (profileError) {
    console.error('[AUTH] Profile fetch error for', user.email, ':', JSON.stringify(profileError));
  }

  const role = getUserRole(user.email, profile?.role);

  return {
    id: user.id,
    email: user.email,
    role,
    is_producer: profile?.is_producer ?? false,
    producer_name: profile?.producer_name ?? null,
    profile,
  };
}

export function isAdmin(email: string): boolean {
  return SUPER_ADMINS.includes(email.toLowerCase() as typeof SUPER_ADMINS[number]);
}

export { getUserRole };
