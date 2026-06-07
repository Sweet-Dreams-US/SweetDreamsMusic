// components/layout/FooterSlot.tsx
//
// Server wrapper around <Footer>. Resolves the site's feature/nav flags and
// passes the FILTERED nav + footer-extra links down. Mirrors HeaderSlot; the
// settings read is cache()-deduped with HeaderSlot in the same render.

import { NAV_LINKS, FOOTER_EXTRA_LINKS } from '@/lib/constants';
import { visibleNavLinks } from '@/lib/site-settings';
import { getSiteSettings } from '@/lib/site-settings-server';
import Footer from './Footer';

export default async function FooterSlot() {
  const settings = await getSiteSettings();
  return (
    <Footer
      navLinks={visibleNavLinks(NAV_LINKS, settings)}
      footerLinks={visibleNavLinks(FOOTER_EXTRA_LINKS, settings)}
    />
  );
}
