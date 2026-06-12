import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { sendWelcomeEmail } from '@/lib/email';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const type = searchParams.get('type');
  const next = type === 'recovery' ? '/reset-password' : (searchParams.get('next') ?? '/');

  if (code) {
    const response = NextResponse.redirect(`${origin}${next}`);
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Send welcome email to newly created users
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const createdAt = new Date(user.created_at);
          const now = new Date();
          const ageMs = now.getTime() - createdAt.getTime();
          // If user was created less than 2 minutes ago, this is a new signup confirmation
          if (ageMs < 2 * 60 * 1000) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('display_name')
              .eq('user_id', user.id)
              .single();
            const name = profile?.display_name || user.user_metadata?.full_name || 'there';
            sendWelcomeEmail(user.email!, name);
          }
        }
      } catch (e) {
        // Don't block the redirect if the welcome email fails
        console.error('Welcome email error:', e);
      }

      return response;
    }
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
