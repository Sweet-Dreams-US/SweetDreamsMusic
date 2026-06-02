'use client';

import { useState } from 'react';
import { Calendar, Music, Users, DollarSign, Clock, Video, Mic, FileText, LayoutDashboard, BarChart3, Bell, PartyPopper, Film, ClipboardList, Package } from 'lucide-react';
import type { SessionUser } from '@/lib/auth';
import AdminOverview from './AdminOverview';
import BookingManager from './BookingManager';
import BeatManager from './BeatManager';
import UserManager from './UserManager';
import Accounting from './Accounting';
import StudioBlocks from './StudioBlocks';
import MediaSales from './MediaSales';
import MediaCatalog from './MediaCatalog';
import MediaOrders from './MediaOrders';
import ProducerApplications from './ProducerApplications';
import ContractsViewer from './ContractsViewer';
import ClientCRM from './ClientCRM';
import PlatformAnalytics from './PlatformAnalytics';
import Notifications from './Notifications';
import AdminEvents from './AdminEvents';
import PackageTemplates from './PackageTemplates';

type Tab = 'overview' | 'clients' | 'accounting' | 'bookings' | 'events' | 'media' | 'media-catalog' | 'media-orders' | 'packages' | 'blocks' | 'beats' | 'producers' | 'contracts' | 'users' | 'analytics' | 'notifications';

export default function AdminDashboard({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<Tab>('overview');

  const tabs: { key: Tab; label: string; icon: typeof Calendar }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'clients', label: 'Clients', icon: Users },
    { key: 'accounting', label: 'Accounting', icon: DollarSign },
    { key: 'bookings', label: 'Bookings', icon: Calendar },
    { key: 'events', label: 'Events', icon: PartyPopper },
    { key: 'media', label: 'Media Sales', icon: Video },
    { key: 'media-catalog', label: 'Media Catalog', icon: Film },
    { key: 'media-orders', label: 'Media Orders', icon: ClipboardList },
    // Packages & memberships sit alongside media catalog/orders since
    // they're a sibling concept (bundling offerings + studio time + beats).
    // Round A is read-only foundation.
    { key: 'packages', label: 'Packages', icon: Package },
    { key: 'blocks', label: 'Block Off', icon: Clock },
    { key: 'beats', label: 'Beat Store', icon: Music },
    { key: 'producers', label: 'Producers', icon: Mic },
    { key: 'contracts', label: 'Contracts', icon: FileText },
    { key: 'users', label: 'Users', icon: Users },
    { key: 'analytics', label: 'Analytics', icon: BarChart3 },
    { key: 'notifications', label: 'Notifications', icon: Bell },
  ];

  return (
    <>
      <section className="bg-white text-black min-h-[60vh]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Mobile Tabs — above everything */}
          <div className="lg:hidden mb-6">
            <div className="flex flex-wrap gap-1.5">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-2 transition-colors inline-flex items-center gap-1.5 rounded ${
                    tab === t.key
                      ? 'bg-black text-white'
                      : 'bg-black/5 text-black/50 hover:bg-black/10'
                  }`}
                >
                  <t.icon className="w-3 h-3" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-8">
            {/* Desktop Sidebar */}
            <aside className="hidden lg:block w-52 shrink-0 self-start sticky top-24">
              <nav className="space-y-1">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`w-full text-left font-mono text-xs font-semibold uppercase tracking-wider px-4 py-3 transition-colors flex items-center gap-2.5 rounded ${
                      tab === t.key
                        ? 'bg-black text-white'
                        : 'text-black/50 hover:bg-black/5 hover:text-black/80'
                    }`}
                  >
                    <t.icon className="w-4 h-4 shrink-0" />
                    {t.label}
                  </button>
                ))}
              </nav>
            </aside>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
          {tab === 'overview' && <AdminOverview onNavigate={(t) => setTab(t)} />}
          {tab === 'clients' && <ClientCRM />}
          {tab === 'accounting' && <Accounting />}
          {tab === 'bookings' && <BookingManager />}
          {tab === 'events' && <AdminEvents />}
          {tab === 'media' && <MediaSales />}
          {tab === 'media-catalog' && <MediaCatalog />}
          {tab === 'media-orders' && <MediaOrders />}
          {tab === 'packages' && <PackageTemplates />}
          {tab === 'blocks' && <StudioBlocks />}
          {tab === 'beats' && <BeatManager />}
          {tab === 'producers' && <ProducerApplications />}
          {tab === 'contracts' && <ContractsViewer />}
          {tab === 'users' && <UserManager />}
          {tab === 'analytics' && <PlatformAnalytics />}
          {tab === 'notifications' && <Notifications />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
