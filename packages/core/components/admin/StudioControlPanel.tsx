'use client';

// StudioControlPanel — the white-label "run the whole studio" admin surface.
// A second-level tabbed shell (mirrors RewardsManager's inner tabs) housing the
// four management sections. Each section is filled in by its own build phase:
//   - Features & Navigation (P2) — feature/page on-off toggles
//   - Studios & Pricing      (P3) — studio_rooms rates/hours/tiers/surcharges editor
//   - Revenue Shares         (P4) — per-studio + per-person splits + what-if
//   - Content                (P5) — site_content CMS for public pages
// Sections not yet built render a ComingSoon placeholder so phases drop in
// without reshaping the shell.

import { useState } from 'react';
import { ToggleLeft, DollarSign, Percent, FileText, Building2, Mic, Calculator } from 'lucide-react';
import FeaturesNavPanel from './FeaturesNavPanel';
import StudiosManager from './StudiosManager';
import RevenueSharesManager from './RevenueSharesManager';
import SiteContentManager from './SiteContentManager';
import BrandManager from './BrandManager';
import EngineersManager from './EngineersManager';
import TaxProfileManager from './TaxProfileManager';

type Section = 'features' | 'studios' | 'revenue' | 'content' | 'brand' | 'team' | 'tax';

const SECTIONS: { key: Section; label: string; icon: typeof ToggleLeft }[] = [
  { key: 'features', label: 'Features & Nav', icon: ToggleLeft },
  { key: 'studios', label: 'Studios & Pricing', icon: DollarSign },
  { key: 'team', label: 'Team', icon: Mic },
  { key: 'revenue', label: 'Revenue Shares', icon: Percent },
  { key: 'content', label: 'Content', icon: FileText },
  { key: 'brand', label: 'Brand', icon: Building2 },
  { key: 'tax', label: 'Tax Profile', icon: Calculator },
];

export default function StudioControlPanel() {
  const [section, setSection] = useState<Section>('features');

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold uppercase tracking-wider">Studio Control Panel</h2>
        <p className="font-mono text-xs text-black/50 mt-1">
          Manage how your studio runs — features, pricing, revenue splits, and page content.
        </p>
      </div>

      {/* Inner tabs */}
      <div className="flex gap-0 border-b border-black/10 mb-6 overflow-x-auto">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 border-b-2 transition-colors flex-shrink-0 inline-flex items-center gap-1.5 ${
              section === s.key
                ? 'border-accent text-black'
                : 'border-transparent text-black/40 hover:text-black/70'
            }`}
          >
            <s.icon className="w-3.5 h-3.5" />
            {s.label}
          </button>
        ))}
      </div>

      {section === 'features' && <FeaturesNavPanel />}
      {section === 'studios' && <StudiosManager />}
      {section === 'team' && <EngineersManager />}
      {section === 'revenue' && <RevenueSharesManager />}
      {section === 'content' && <SiteContentManager />}
      {section === 'brand' && <BrandManager />}
      {section === 'tax' && <TaxProfileManager />}
    </div>
  );
}
