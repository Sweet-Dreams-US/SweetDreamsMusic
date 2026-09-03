import Link from 'next/link';
import { Instagram, Youtube, Mail, Phone, MapPin } from 'lucide-react';
import { SOCIAL_LINKS } from '@/lib/constants';
import { getSiteContent } from '@/lib/site-content-server';
import { content } from '@/lib/site-content';
import { getBrand } from '@/lib/brand-server';

// navLinks + footerLinks are pre-filtered by the server (FooterSlot) per the
// site's feature/nav flags. Locked items always survive the filter. Editorial
// strings (brand intro, contact headline, company label) come from the CMS
// (site_content); contact details come from brand_settings via getBrand().
export default async function Footer({
  navLinks,
  footerLinks,
}: {
  navLinks: readonly { href: string; label: string }[];
  footerLinks: readonly { href: string; label: string }[];
}) {
  const c = await getSiteContent();
  const brand = await getBrand();
  const telHref = brand.phone ? `tel:${brand.phone.replace(/[^\d+]/g, '')}` : '';
  return (
    <footer className="bg-black text-white border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {/* Brand */}
          <div>
            <h3 className="text-2xl mb-4">{brand.name.toUpperCase()}</h3>
            <p className="font-mono text-white/60 text-sm leading-relaxed">
              {content(c, 'footer.brand.intro')}
            </p>
          </div>

          {/* Navigation — Header nav + footer-only extras (Blog) */}
          <div>
            <h4 className="text-lg mb-4">NAVIGATE</h4>
            <nav aria-label="Footer" className="flex flex-col gap-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="font-mono text-sm text-white/60 hover:text-accent transition-colors no-underline"
                >
                  {link.label}
                </Link>
              ))}
              {footerLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="font-mono text-sm text-white/60 hover:text-accent transition-colors no-underline"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/recording"
                className="font-mono text-sm text-white/60 hover:text-accent transition-colors no-underline"
              >
                Looking to record?
              </Link>
            </nav>
          </div>

          {/* Contact + socials */}
          <div>
            <h4 className="text-lg mb-4">GET IN TOUCH</h4>
            <div className="font-mono text-sm text-white/60 space-y-2">
              <p>{content(c, 'footer.contact.headline')}</p>
              {brand.email && (
                <a href={`mailto:${brand.email}`} className="flex items-center gap-2 hover:text-accent transition-colors no-underline text-white/60">
                  <Mail className="w-4 h-4 shrink-0" /> {brand.email}
                </a>
              )}
              {brand.phone && (
                <a href={telHref} className="flex items-center gap-2 hover:text-accent transition-colors no-underline text-white/60">
                  <Phone className="w-4 h-4 shrink-0" /> {brand.phone}
                </a>
              )}
              <p className="flex items-center gap-2">
                <MapPin className="w-4 h-4 shrink-0" /> {brand.address.city}, {brand.address.state}
              </p>
              <div className="flex items-center gap-4 pt-2">
                <a href={SOCIAL_LINKS.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="hover:text-accent transition-colors text-white/60">
                  <Instagram className="w-5 h-5" />
                </a>
                <a href={SOCIAL_LINKS.youtube} target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="hover:text-accent transition-colors text-white/60">
                  <Youtube className="w-5 h-5" />
                </a>
                <a href={SOCIAL_LINKS.tiktok} target="_blank" rel="noopener noreferrer" className="font-mono text-xs font-bold uppercase tracking-wider hover:text-accent transition-colors no-underline text-white/60">
                  TikTok
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="font-mono text-xs text-white/60">
            &copy; {new Date().getFullYear()} Sweet Dreams Music LLC. All rights reserved.
          </p>
          {/* Legal links — always rendered (Meta App Review requires the
              privacy/ToS/data-deletion URLs to be live and discoverable). */}
          <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link href="/privacy-policy" className="font-mono text-xs text-white/60 hover:text-accent transition-colors no-underline">
              Privacy Policy
            </Link>
            <Link href="/tos" className="font-mono text-xs text-white/60 hover:text-accent transition-colors no-underline">
              Terms of Service
            </Link>
            <Link href="/user-data-deletion" className="font-mono text-xs text-white/60 hover:text-accent transition-colors no-underline">
              Data Deletion
            </Link>
          </nav>
          <Link
            href="https://sweetdreams.us"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-white/60 hover:text-accent transition-colors no-underline"
          >
            {content(c, 'footer.company.label')}
          </Link>
        </div>
      </div>
    </footer>
  );
}
