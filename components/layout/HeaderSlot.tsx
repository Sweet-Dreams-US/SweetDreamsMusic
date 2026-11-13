// components/layout/HeaderSlot.tsx
//
// Server wrapper around the client <Header>. Resolves the site's feature/nav
// flags and passes the FILTERED nav links down as a prop, so disabled
// features/pages never appear in the header. Mirrors MessageWidgetSlot (a server
// component living in the root layout). React cache() dedupes the settings read
// with FooterSlot + any page guard in the same render.
//
// Blog link: shown only while the Blog is switched on in the control panel AND
// at least one post has reached its release date. Checked per request, so the
// link appears (and would disappear) without a deploy.

import { NAV_LINKS } from '@/lib/constants';
import { isHrefEnabled, visibleNavLinks } from '@/lib/site-settings';
import { getSiteSettings } from '@/lib/site-settings-server';
import { getBrand } from '@/lib/brand-server';
import { hasReleasedPosts } from '@/lib/blog/posts';
import Header from './Header';

export default async function HeaderSlot() {
  const [settings, brand, blogReleased] = await Promise.all([getSiteSettings(), getBrand(), hasReleasedPosts()]);
  const links: { href: string; label: string }[] = [...visibleNavLinks(NAV_LINKS, settings)];
  if (blogReleased && isHrefEnabled('/blog', settings)) {
    const contactAt = links.findIndex((l) => l.href === '/contact');
    links.splice(contactAt === -1 ? links.length : contactAt, 0, { href: '/blog', label: 'Blog' });
  }
  return <Header navLinks={links} brandName={brand.name.toUpperCase()} />;
}
