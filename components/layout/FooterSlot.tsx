// components/layout/FooterSlot.tsx
//
// Server wrapper around <Footer>. Resolves the site's feature/nav flags and
// passes the FILTERED nav + footer-extra links down. Mirrors HeaderSlot; the
// settings read is cache()-deduped with HeaderSlot in the same render.
//
// The Blog footer link only shows once at least one post has reached its
// release date (checked per request, no deploy needed).

import { NAV_LINKS, FOOTER_EXTRA_LINKS } from '@/lib/constants';
import { visibleNavLinks } from '@/lib/site-settings';
import { getSiteSettings } from '@/lib/site-settings-server';
import { hasReleasedPosts } from '@/lib/blog/posts';
import Footer from './Footer';

export default async function FooterSlot() {
  const [settings, blogReleased] = await Promise.all([getSiteSettings(), hasReleasedPosts()]);
  return (
    <Footer
      navLinks={visibleNavLinks(NAV_LINKS, settings)}
      footerLinks={visibleNavLinks(FOOTER_EXTRA_LINKS, settings).filter((l) => l.href !== '/blog' || blogReleased)}
    />
  );
}
