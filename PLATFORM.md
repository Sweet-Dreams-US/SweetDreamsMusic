# Sweet Dreams Music — Platform Documentation

## Overview

Sweet Dreams Music is a full-service recording studio platform in Fort Wayne, Indiana. It combines studio session booking, a beat marketplace, artist development tools, and media production tracking into one unified platform for artists, engineers, producers, and studio management.

**URL**: sweetdreamsmusic.com
**Business**: Sweet Dreams Music LLC, Fort Wayne, IN
**Tech Stack**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Supabase (auth + DB + storage), Stripe (payments), Resend (emails), Vercel (hosting)

---

## Site Map

### Public Pages (No Login Required)

| Page | URL | Purpose |
|------|-----|---------|
| Home | `/` | Studio showcase, services overview, pricing preview, team highlight |
| Pricing | `/pricing` | Detailed hourly rates, The Sweet 4 (4hr flat-rate), surcharges, band recording |
| Book a Session | `/book` | Interactive booking flow with availability calendar, time selection, Stripe checkout |
| Engineers | `/engineers` | Engineer profiles with specialties, studio assignments, and booking links |
| Beat Store | `/beats` | Browse, search, and filter beats by genre, BPM, producer. Audio previews |
| Beat Detail | `/beats/[id]` | Full beat page with player, license options, pricing, and purchase |
| Lyrics Pad | `/beats/[id]/write` | Write lyrics while listening to a beat |
| Sell Beats | `/sell-beats` | Producer application form to join the beat store |
| Media | `/media` | Music video portfolio and media services |
| About | `/about` | Studio history, team, and mission |
| Contact | `/contact` | Contact form |
| Public Profile | `/u/[slug]` | Artist's public profile with bio, music showcase, projects, social links |
| Login | `/login` | Sign in or create account (toggle between modes) |
| Reset Password | `/reset-password` | Password reset flow |

### Authenticated Pages (Login Required)

| Page | URL | Access | Purpose |
|------|-----|--------|---------|
| Dashboard | `/dashboard` | All users | Upcoming sessions, files, purchases, saved beats, XP widget |
| My Files | `/dashboard/files` | All users | All session deliverables with search, sort, filter, download, public toggle |
| My Purchases | `/dashboard/purchases` | All users | Beat purchase history, license viewer, re-download |
| Profile Editor | `/dashboard/profile` | All users | Edit display name, bio, photo, social links, career stage, genre |
| Session Prep | `/dashboard/prep/[id]` | All users | Pre-session checklist: beat upload, references, goals, lyrics |
| Artist Hub | `/dashboard/hub` | All users | Projects, goals, metrics, calendar, achievements, XP, roadmap |
| Updates | `/dashboard/updates` | All users | Platform changelog pulled from GitHub commits, role-filtered |

### Engineer Pages

| Page | URL | Purpose |
|------|-----|---------|
| Engineer Dashboard | `/engineer` | Session management, client library, files, invites, accounting |

**Tabs within engineer dashboard:**
- **Sessions**: View available/claimed sessions, accept/pass, session details
- **Files**: Upload deliverables for clients, manage file library
- **Client Library**: Search clients, view files, add notes, download files
- **Create Invite**: Send session invites with pricing, optional media service add-ons
- **Accounting**: Personal earnings, session revenue (60% split), media commissions

### Producer Pages

| Page | URL | Purpose |
|------|-----|---------|
| Producer Dashboard | `/producer` | Beat management, sales tracking, earnings, private sales |

**Tabs within producer dashboard:**
- **My Beats**: View uploaded beats, status badges (Pending Review / Live / Sold)
- **Sales**: Purchase history by beat
- **Earnings**: Revenue breakdown with 60/40 split
- **Private Sales**: Create and track private/unlisted beat sales

### Admin Pages

| Page | URL | Purpose |
|------|-----|---------|
| Admin Dashboard | `/admin` | Complete business management |

**Tabs within admin dashboard:**
- **Overview**: KPI dashboard — today/week/month metrics, recent activity, pending items
- **Bookings**: All bookings with status management, engineer assignment, payment recording
- **Studio Blocks**: Block off studio time for maintenance or private events
- **Beats**: Beat store management, upload, pricing, cover art
- **Producers**: Review and approve producer applications
- **Contracts**: View all signed agreements, license templates, private sale contracts
- **Users**: User role management
- **Media Sales**: Log and track media production revenue
- **Accounting**: Full financial view — sessions, beats, media, payroll, business profit

---

## Features by Role

### For Artists (Regular Users)

**Studio Booking**
- Browse real-time availability with color-coded calendar (green/yellow/red)
- Select studio, date, time, and duration
- See pricing breakdown including night fees and the Booking Rush Fee
- Pay 50% deposit via Stripe (card, Cash App Pay, bank transfer)
- Receive confirmation email with session details
- Prepare for sessions with the prep form (upload beats, add references, set goals)
- Receive 1-hour reminder before sessions
- Request reschedules from dashboard

**Beat Store**
- Search and filter by genre, producer, tags
- Preview beats with audio player
- Three license tiers: MP3 Lease ($29.99), Trackout Lease ($74.99), Exclusive ($400+)
- Save beats to library for later
- Write lyrics while listening with the built-in writing pad
- View all purchases and licenses from dashboard
- Re-download files anytime (10 downloads per purchase)

**Artist Hub**
- Track Spotify, YouTube, Instagram, TikTok, SoundCloud metrics manually
- Trend visualization with sparklines and growth rates
- Set and track career goals with progress bars
- Manage release projects through 8 phases (Concept to Released)
- Content calendar for planning releases, posts, and shows
- Achievement system with 14 milestones and XP rewards
- Interactive career roadmap with checkable items
- Session notes from engineers (visibility controlled)

**Profile**
- Public profile at `/u/your-name`
- Bio, profile photo, cover photo
- Social media links (Spotify, Apple Music, Instagram, YouTube, etc.)
- Toggle session files to public for sharing unreleased music
- Career stage and genre badges
- Producer beats displayed if applicable

### For Engineers

**Session Management**
- View all available (unclaimed) sessions
- Priority window for requested engineer (2-hour exclusive claim period)
- Accept or pass on sessions
- View full session details including client prep
- Upload deliverable files directly to client's library
- Record cash payments, send Stripe payment links
- Create session invites with optional bundled media services
- Track personal earnings (60% session split + media commissions)

**Client Library**
- Searchable client directory
- Per-client file management with download
- Session notes with visibility control (visible/hidden from client)
- Upload files to any client's library

### For Producers

**Beat Store**
- Admin uploads beats on your behalf (pending your review)
- Review beat details, edit title/genre/BPM/key/tags
- Upload custom cover photo during review
- Sign licensing agreement to go live
- Track all sales and earnings (60% of each sale)
- Create private sales for off-platform deals
- Receive email notification when beats sell

**Private Beat Sales**
- Create unlisted/private beat sales
- Upload custom beat files for beats not in the store
- Send buyer a private link via email
- Buyer signs license agreement, pays via Stripe or records cash/Venmo
- All private sales tracked in accounting with proper commission split

### For Admins

**Business Overview**
- KPI dashboard with today/week/month metrics
- Recent activity feed (bookings and beat sales)
- Pending bookings count, outstanding remainders

**Booking Management**
- View all bookings sorted by session date
- Assign engineers to sessions
- Record Cash, Record Stripe, Send Payment Link, Mark Paid in Full
- View bundled media services on bookings
- Handle reschedule requests
- Upload files to any booking

**Financial Tracking**
- Session revenue with engineer/room/status breakdowns
- Beat sales with producer/license breakdowns
- Media sales with crew/type breakdowns
- Payroll tab: per-person earnings across all revenue streams
- Business profit: gross revenue minus payroll plus kept deposits
- Commission splits tracked: 60/40 sessions, 60/40 beats, 15/50/35 media

**Beat Store Management**
- Upload beats with genre dropdown, dollar pricing, auto-generated cover art
- "Sweet Dreams" tag auto-added to every beat
- Producer assignment and notification
- Beat agreement/contract templates viewable
- Private sale creation and tracking

**Contract Management**
- View all 4 contract templates (Producer Agreement, MP3 Lease, Trackout, Exclusive)
- Browse all signed beat licenses
- Browse all producer agreements
- Browse all private sale contracts
- Search and filter by name, email, beat title

---

## Pricing Structure

### Studio Rates
| Room | Single Hour | 2+ Hours | The Sweet 4 (4hr flat) |
|------|------------|----------|------------------|
| Studio A | $70/hr | $60/hr | $260 flat |
| Studio B | $50/hr | $50/hr | $180 flat |

### Surcharges
| Time | Surcharge |
|------|-----------|
| 9 AM - 10 PM | Standard rate |
| 10 PM - 2 AM | +$10/hr (Late Night) |
| 2 AM - 9 AM | +$30/hr (Deep Night) |
| Booking Rush Fee (per booked hour) | +$30/hr <2 hrs out · +$20/hr 2-4 hrs · +$10/hr 4-12 hrs · none 12+ hrs (bands exempt) |

### Revenue Splits
| Stream | Split |
|--------|-------|
| Studio Sessions | 60% engineer / 40% business |
| Beat Sales | 60% producer / 40% platform |
| Media Sales | 15% sales commission / 50% worker / 35% business |

---

## Technical Architecture

### Authentication
- Supabase Auth with email/password
- Server-side session management via middleware
- Role-based access: user, engineer, admin, producer
- Profile auto-created on signup via database trigger

### Payments
- Stripe Checkout for all payments
- Automatic tax calculation enabled
- Supports: Card, Cash App Pay, bank transfers
- Webhook at `/api/booking/webhook` processes all payment events
- Deposit (50%) charged upfront, remainder charged after session

### Email System
- Resend transactional emails
- 15+ email types: confirmations, reminders, invites, purchase receipts, producer notifications
- Branded HTML templates with Sweet Dreams styling

### Storage
- `media` bucket: beat files, cover art, profile photos
- `client-audio-files` bucket: session deliverables (private, signed URLs)

### Cron Jobs
- Session reminders: every 15 minutes, sends 1-hour-before alerts
- Priority expiry: hourly, handles engineer claim windows
- Metrics fetch: daily, auto-pulls Spotify/YouTube data

### Database
- 30+ tables in Supabase (PostgreSQL)
- Row Level Security (RLS) on all tables
- Full migration history in `supabase-migrations/`

---

## Version History

Platform updates are automatically pulled from GitHub commit history and displayed at `/dashboard/updates`. Each update is tagged by role (admin, engineer, producer, client) so users only see what's relevant to them.

Current version: **v2.9** (as of April 2026)

---

Sweet Dreams Music LLC
Fort Wayne, Indiana
sweetdreamsmusic.com
