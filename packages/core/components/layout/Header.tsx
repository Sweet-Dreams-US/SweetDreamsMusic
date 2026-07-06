'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Menu, X, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { trackMeta } from '@/lib/meta-pixel';

// Brand logo shown in the nav. Transparent PNG (2151×1223) sized to the header
// height; alt/aria-label keep the brand name available to SEO + screen readers.
const BRAND_LOGO_URL = 'https://fweeyjnqwxywmpmnqpts.supabase.co/storage/v1/object/public/SweetDreamsMusicPictures/SDMLogoJuly26.png';

// navLinks are pre-filtered by the server (HeaderSlot) per the site's feature/nav
// flags, so disabled features/pages never render. Locked items (Book, Beats,
// Pricing) always survive the filter.
export default function Header({ navLinks, brandName }: { navLinks: readonly { href: string; label: string }[]; brandName: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<{ email: string } | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setUser({ email: user.email });
    });
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/95 backdrop-blur-sm border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20">
          <Link href="/" className="flex items-center no-underline" aria-label={brandName}>
            {/* Fixed-size box the logo fills via object-contain — guarantees it
                fits the nav height (it can never overflow to its intrinsic size). */}
            <span className="relative block h-10 sm:h-12 w-[72px] sm:w-[88px] shrink-0">
              <Image
                src={BRAND_LOGO_URL}
                alt={brandName}
                fill
                priority
                sizes="88px"
                className="object-contain object-left"
              />
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav aria-label="Primary" className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href}
                aria-current={pathname === link.href ? 'page' : undefined}
                className={cn(
                  'font-mono text-sm font-medium tracking-wider uppercase px-4 py-2 transition-colors no-underline',
                  pathname === link.href ? 'text-accent' : 'text-white/70 hover:text-white'
                )}>
                {link.label}
              </Link>
            ))}

            {user ? (
              <Link href="/dashboard"
                className="ml-4 border border-accent text-accent font-mono text-sm font-bold tracking-wider uppercase px-4 py-2 hover:bg-accent hover:text-black transition-colors no-underline inline-flex items-center gap-2">
                <User className="w-4 h-4" /> Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login"
                  className="ml-2 text-white/70 hover:text-white font-mono text-sm font-medium tracking-wider uppercase px-4 py-2 transition-colors no-underline">
                  Sign In
                </Link>
                <Link href="/book"
                  onClick={() => trackMeta('ViewContent', { content_name: 'Header nav - Book now', content_category: 'Studio session booking' })}
                  className="ml-2 bg-accent text-black font-mono text-sm font-bold tracking-wider uppercase px-6 py-3 hover:bg-accent/90 transition-colors no-underline">
                  BOOK NOW
                </Link>
              </>
            )}
          </nav>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden text-white p-2"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Mobile" className="lg:hidden bg-black border-t border-white/10">
          <div className="px-4 py-4 flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}
                aria-current={pathname === link.href ? 'page' : undefined}
                className={cn(
                  'font-mono text-base font-medium tracking-wider uppercase px-4 py-3 transition-colors no-underline',
                  pathname === link.href ? 'text-accent' : 'text-white/70 hover:text-white'
                )}>
                {link.label}
              </Link>
            ))}

            {user ? (
              <Link href="/dashboard" onClick={() => setMobileOpen(false)}
                className="mt-2 border border-accent text-accent font-mono text-base font-bold tracking-wider uppercase px-4 py-4 text-center hover:bg-accent hover:text-black transition-colors no-underline inline-flex items-center justify-center gap-2">
                <User className="w-4 h-4" /> Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" onClick={() => setMobileOpen(false)}
                  className="mt-2 text-white/70 font-mono text-base font-medium tracking-wider uppercase px-4 py-3 text-center no-underline">
                  Sign In
                </Link>
                <Link href="/book" onClick={() => { trackMeta('ViewContent', { content_name: 'Header nav - Book now', content_category: 'Studio session booking' }); setMobileOpen(false); }}
                  className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-4 py-4 text-center hover:bg-accent/90 transition-colors no-underline">
                  BOOK NOW
                </Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
