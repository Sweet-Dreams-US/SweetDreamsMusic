// lib/messaging.ts
//
// Round 9: shared types + helpers for the unified messaging system.
// One thread of each kind (sweet_dreams, media_booking, producer_dm)
// with one messages table. See migration 052 for schema details.

// 'dm' = the generic matrix DM kind (076); 'producer_dm' is its legacy synonym
// kept for read-compat. 'sweet_dreams' is the per-user STUDIO thread (the DB
// string is frozen — live code queries the literal; the UI labels it "Studio").
export type ThreadKind = 'sweet_dreams' | 'media_booking' | 'producer_dm' | 'dm';
export type MessageKind = 'chat' | 'update' | 'booking_notification';
export type AuthorRole = 'admin' | 'buyer' | 'engineer' | 'producer' | 'media_manager' | 'system';
export type ParticipantRole = 'owner' | 'staff' | 'producer';

export interface Attachment {
  label: string;
  url: string;
  kind: 'image' | 'video' | 'file' | 'link';
}

export interface Thread {
  id: string;
  kind: ThreadKind;
  owner_user_id: string | null;
  media_booking_id: string | null;
  subject: string | null;
  last_message_at: string;
  created_at: string;
}

export interface ThreadWithMeta extends Thread {
  display_name: string;        // computed at fetch time — "Sweet Dreams" / "Single Drop" / "Cole ↔ PRVRB"
  unread: boolean;
  last_message_preview?: string;
  last_message_role?: AuthorRole;
  participant_count?: number;
}

export interface Message {
  id: string;
  thread_id: string;
  author_user_id: string | null;
  author_role: AuthorRole;
  kind: MessageKind;
  body: string | null;
  attachments: Attachment[];
  created_at: string;
}

export interface MessageWithAuthor extends Message {
  author_name: string;
}

// ────────────────────────────────────────────────────────────────────
// Bubble style derivation — Round 9c will use this in MessageBubble.tsx.
// Kind overrides for system-style; otherwise author_role decides.
// ────────────────────────────────────────────────────────────────────
export type BubbleStyle = 'yellow' | 'black' | 'gray' | 'white-outline';

export function bubbleStyleFor(message: Pick<Message, 'kind' | 'author_role'>): BubbleStyle {
  if (message.kind === 'update') return 'gray';
  if (message.kind === 'booking_notification') return 'white-outline';
  // chat-style: studio (admin/engineer) is yellow, others are black
  if (message.author_role === 'admin' || message.author_role === 'engineer' || message.author_role === 'media_manager') return 'yellow';
  return 'black';
}

// ────────────────────────────────────────────────────────────────────
// Display-name derivation for thread cards in the inbox list.
// Threads don't carry rich metadata — we resolve at fetch time using
// adjacent context (offering title for bookings, participants for DMs,
// hardcoded "Sweet Dreams Music" for the SD thread).
// ────────────────────────────────────────────────────────────────────
export function defaultThreadDisplayName(t: Thread): string {
  if (t.kind === 'sweet_dreams') return 'Sweet Dreams Music';
  if (t.kind === 'producer_dm' || t.kind === 'dm') return t.subject || 'Direct message';
  return t.subject || 'Booking conversation';
}
