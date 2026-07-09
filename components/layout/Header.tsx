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
    <>
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

    </header>

    {/* Mobile Nav — right-side drawer over a dimmed backdrop. Rendered as a
        SIBLING of <header> (NOT a child): the header's `backdrop-blur` sets a
        containing block for `position: fixed` descendants, which would clamp a
        nested fixed drawer to the header's height (collapsing it to a sliver).
        As a sibling it positions against the viewport → true full height. */}
    {mobileOpen && (
      <div className="lg:hidden fixed inset-x-0 top-16 sm:top-20 bottom-0 z-40">
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="absolute inset-0 w-full h-full bg-black/70 cursor-default"
        />
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="absolute right-0 top-0 h-full w-[17rem] max-w-[85vw] bg-black border-l border-white/10 px-6 py-8 flex flex-col items-end overflow-y-auto"
        >
          <p className="font-mono text-xs tracking-[0.25em] uppercase text-white/40 mb-4">
            Explore
          </p>
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}
              aria-current={pathname === link.href ? 'page' : undefined}
              className={cn(
                'font-mono text-lg font-medium tracking-wider uppercase py-2.5 text-right transition-colors no-underline whitespace-nowrap',
                pathname === link.href ? 'text-accent' : 'text-white/80 hover:text-white'
              )}>
              {link.label}
            </Link>
          ))}

          {/* CTA + footer pinned to the bottom of the full-height panel */}
          <div className="mt-auto pt-8 w-full flex flex-col items-end gap-6">
            {user ? (
              <Link href="/dashboard" onClick={() => setMobileOpen(false)}
                className="w-full border border-accent text-accent font-mono text-base font-bold tracking-wider uppercase px-4 py-3.5 rounded-full text-center hover:bg-accent hover:text-black transition-colors no-underline inline-flex items-center justify-center gap-2 whitespace-nowrap">
                <User className="w-4 h-4" /> Dashboard
              </Link>
            ) : (
              <>
                <Link href="/book" onClick={() => { trackMeta('ViewContent', { content_name: 'Header nav - Book now', content_category: 'Studio session booking' }); setMobileOpen(false); }}
                  className="w-full border border-accent text-accent font-mono text-base font-bold tracking-wider uppercase px-4 py-3.5 rounded-full text-center hover:bg-accent hover:text-black transition-colors no-underline whitespace-nowrap">
                  Book a Session
                </Link>
                <Link href="/login" onClick={() => setMobileOpen(false)}
                  className="font-mono text-sm tracking-wider uppercase text-white/60 hover:text-white transition-colors no-underline whitespace-nowrap">
                  Sign In
                </Link>
              </>
            )}
            <div className="w-full border-t border-white/10 pt-5 text-right">
              <p className="font-mono text-sm text-white/70 whitespace-nowrap">{brandName}</p>
              <p className="font-mono text-xs text-white/40 mt-1 whitespace-nowrap">Fort Wayne, Indiana</p>
            </div>
          </div>
        </nav>
      </div>
    )}
    </>
  );
}
