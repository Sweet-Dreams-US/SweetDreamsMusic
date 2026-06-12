import Link from 'next/link';
import { Music, Headphones, Mail, DollarSign } from 'lucide-react';

type CTAType = 'book' | 'beats' | 'contact' | 'sell-beats';

interface BlogCTAProps {
  type: CTAType;
  customText?: string | null;
  customUrl?: string | null;
}

const CTA_CONFIG: Record<CTAType, { icon: typeof Music; title: string; description: string; buttonText: string; href: string }> = {
  book: {
    icon: Headphones,
    title: 'Ready to Record?',
    description: 'Book a session at Sweet Dreams Music. Two studios, four engineers, professional results.',
    buttonText: 'BOOK A SESSION',
    href: '/book',
  },
  beats: {
    icon: Music,
    title: 'Browse Our Beat Store',
    description: 'Find your next hit. Hundreds of exclusive and leasable beats from our producers.',
    buttonText: 'BROWSE BEATS',
    href: '/beats',
  },
  contact: {
    icon: Mail,
    title: 'Get in Touch',
    description: 'Have questions about our services? Reach out and we will get back to you.',
    buttonText: 'CONTACT US',
    href: '/contact',
  },
  'sell-beats': {
    icon: DollarSign,
    title: 'Sell Your Beats',
    description: 'Join our beat store as a producer. Keep 60% of every sale.',
    buttonText: 'START SELLING',
    href: '/sell-beats',
  },
};

export default function BlogCTA({ type, customText, customUrl }: BlogCTAProps) {
  const config = CTA_CONFIG[type] || CTA_CONFIG.book;
  const Icon = config.icon;

  return (
    <div className="bg-black text-white p-6 sm:p-8 my-8 border-l-4 border-[#F4C430]">
      <div className="flex items-start gap-4">
        <div className="hidden sm:flex items-center justify-center w-12 h-12 bg-[#F4C430]/10 shrink-0">
          <Icon className="w-6 h-6 text-[#F4C430]" />
        </div>
        <div className="flex-1">
          <h4 className="font-bold uppercase tracking-wide text-base mb-2">
            {config.title}
          </h4>
          <p className="font-mono text-sm text-white/60 mb-4">
            {customText || config.description}
          </p>
          <Link
            href={customUrl || config.href}
            className="inline-block bg-[#F4C430] text-black font-mono text-xs font-bold tracking-wider uppercase px-6 py-3 hover:bg-[#F4C430]/90 transition-colors no-underline"
          >
            {config.buttonText}
          </Link>
        </div>
      </div>
    </div>
  );
}
