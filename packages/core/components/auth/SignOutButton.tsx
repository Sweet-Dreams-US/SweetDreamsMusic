'use client';

import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function SignOutButton() {
  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  return (
    <button
      onClick={handleSignOut}
      className="border border-white/20 text-white/60 font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:border-red-400 hover:text-red-400 transition-colors inline-flex items-center gap-2"
    >
      <LogOut className="w-4 h-4" />
      Sign Out
    </button>
  );
}
