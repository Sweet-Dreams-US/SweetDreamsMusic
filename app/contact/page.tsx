import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/constants';
import ContactForm from '@/components/shared/ContactForm';
import { requireHref } from '@/lib/site-settings-server';
import { getSiteContent } from '@/lib/site-content-server';
import { content } from '@/lib/site-content';

// Reads the site's nav flags at request time so the page can 404 when disabled.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contact Us — Get in Touch',
  description: 'Contact Sweet Dreams Music recording studio in Fort Wayne, IN. Questions about booking, pricing, beat licensing, or studio services? Send us a message and we\'ll get back to you.',
  alternates: { canonical: `${SITE_URL}/contact` },
  openGraph: {
    title: 'Contact Sweet Dreams Music — Fort Wayne Recording Studio',
    description: 'Get in touch with Sweet Dreams Music. Questions about booking, pricing, or studio services in Fort Wayne, Indiana.',
    url: `${SITE_URL}/contact`,
    type: 'website',
  },
};

export default async function ContactPage() {
  await requireHref('/contact'); // 404 when the Contact page is disabled
  const c = await getSiteContent();
  return (
    <>
      {/* Hero */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            {content(c, 'contact.hero.kicker')}
          </p>
          <h1 className="text-display-md mb-6">{content(c, 'contact.hero.title')}</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            {content(c, 'contact.hero.intro')}
          </p>
        </div>
      </section>

      {/* Contact Form - White */}
      <section className="bg-white text-black py-20 sm:py-28">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <ContactForm />
        </div>
      </section>
    </>
  );
}
