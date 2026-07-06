'use client';

import { useState } from 'react';
import { Users, Calendar, CalendarOff, Link as LinkIcon, DollarSign, FileAudio, Contact, Film, UserCircle } from 'lucide-react';
import type { SessionUser } from '@/lib/auth';
import ClientLibrary from './ClientLibrary';
import EngineerSessions from './EngineerSessions';
import EngineerCRM from './EngineerCRM';
import CreateInvite from './CreateInvite';
import EngineerAccounting from './EngineerAccounting';
import EngineerFiles from './EngineerFiles';
import EngineerMediaSessions from './EngineerMediaSessions';
import EngineerBonusCard from './EngineerBonusCard';
import EngineerAvailability from './EngineerAvailability';
import EngineerProfile from './EngineerProfile';
import type { StudioConfig } from '@/lib/studio-config';

type Tab =
  | 'sessions'
  | 'media'
  | 'my-clients'
  | 'library'
  | 'files'
  | 'invite'
  | 'availability'
  | 'accounting'
  | 'profile';

export default function EngineerDashboard({ user, studios, engineers }: { user: SessionUser; studios: StudioConfig[]; engineers: readonly { name: string; displayName: string }[] }) {
  const [tab, setTab] = useState<Tab>('sessions');

  const tabs: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: 'sessions', label: 'My Sessions', icon: Calendar },
    { key: 'media', label: 'Media Sessions', icon: Film },
    { key: 'my-clients', label: 'My Clients', icon: Contact },
    { key: 'library', label: 'Client Library', icon: Users },
    { key: 'files', label: 'Files', icon: FileAudio },
    { key: 'invite', label: 'Invite to Session', icon: LinkIcon },
    { key: 'availability', label: 'Availability', icon: CalendarOff },
    { key: 'accounting', label: 'Accounting', icon: DollarSign },
    { key: 'profile', label: 'My Profile', icon: UserCircle },
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
                    tab === t.key ? 'bg-black text-white' : 'bg-black/5 text-black/50 hover:bg-black/10'
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
                      tab === t.key ? 'bg-black text-white' : 'text-black/50 hover:bg-black/5 hover:text-black/80'
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
              {tab === 'sessions' && <><EngineerBonusCard /><EngineerSessions userEmail={user.email} /></>}
              {tab === 'media' && <EngineerMediaSessions />}
              {tab === 'my-clients' && <EngineerCRM userEmail={user.email} />}
              {tab === 'library' && <ClientLibrary />}
              {tab === 'files' && <EngineerFiles />}
              {tab === 'invite' && <CreateInvite studios={studios} engineers={engineers} />}
              {tab === 'availability' && <EngineerAvailability />}
              {tab === 'accounting' && <EngineerAccounting />}
              {tab === 'profile' && <EngineerProfile />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
