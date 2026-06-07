// components/layout/HeaderSlot.tsx
//
// Server wrapper around the client <Header>. Resolves the site's feature/nav
// flags and passes the FILTERED nav links down as a prop, so disabled
// features/pages never appear in the header. Mirrors MessageWidgetSlot (a server
// component living in the root layout). React cache() dedupes the settings read
// with FooterSlot + any page guard in the same render.

import { NAV_LINKS } from '@/lib/constants';
import { visibleNavLinks } from '@/lib/site-settings';
import { getSiteSettings } from '@/lib/site-settings-server';
import { getBrand } from '@/lib/brand-server';
import Header from './Header';

export default async function HeaderSlot() {
  const [settings, brand] = await Promise.all([getSiteSettings(), getBrand()]);
  return <Header navLinks={visibleNavLinks(NAV_LINKS, settings)} brandName={brand.name.toUpperCase()} />;
}
