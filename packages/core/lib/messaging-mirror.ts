// lib/messaging-mirror.ts
//
// Round 9e: writes a parallel "message" into the messages table for
// every transactional email we send. The user reads either the email
// or the in-app thread — both render the same content. Sweet Dreams
// thread is the default target; booking threads when the email is
// about a specific media booking.
//
// Server-only. Fire-and-forget — never blocks the email send. If the
// mirror fails (RLS, missing thread, etc.) we console.error + continue.

import { createServiceClient } from '@/lib/supabase/server';
import type { Attachment } from '@/lib/messaging';

export interface MirrorArgs {
  /** The user this notification is FOR. Mirrors to their Sweet Dreams thread. */
  userId?: string;
  /** Alternative to userId: look up the user by email. Useful when only email is in scope. */
  userEmail?: string;
  /** A media booking this notification is about. Mirrors to that booking's thread. Takes precedence over userId/userEmail. */
  mediaBookingId?: string;
  /** Bubble style: 'update' (gray, system announcements) or 'booking_notification' (white-outline, transactional). */
  kind: 'update' | 'booking_notification';
  /** The text content of the email, plain or basic markdown. Rendered inside the bubble. */
  body: string;
  /** Optional title or subject — prepended to the body for context. */
  subject?: string;
  /** Optional attachments — Drive links, files, images. */
  attachments?: Attachment[];
}

/**
 * Resolve the target thread for this mirror. For booking-scoped notifications
 * we use the booking thread (creating one lazily if missing). For everything
 * else we use the user's Sweet Dreams thread.
 *
 * Returns null if the thread can't be resolved (logged + skipped).
 */
async function resolveTargetThread(args: MirrorArgs): Promise<string | null> {
  const service = createServiceClient();

  if (args.mediaBookingId) {
    // Look for existing booking thread
    const { data: existing } = await service
      .from('message_threads')
      .select('id')
      .eq('kind', 'media_booking')
      .eq('media_booking_id', args.mediaBookingId)
      .maybeSingle();
    if (existing) return (existing as { id: string }).id;

    // Create lazily
    const { data: created, error } = await service
      .from('message_threads')
      .insert({
        kind: 'media_booking',
        media_booking_id: args.mediaBookingId,
        subject: 'Booking conversation',
      })
      .select('id')
      .single();
    if (error || !created) {
      console.error('[messaging-mirror] could not create booking thread:', error);
      return null;
    }
    return (created as { id: string }).id;
  }

  // Resolve userId from email if needed
  let userId = args.userId;
  if (!userId && args.userEmail) {
    const { data: profileRow } = await service
      .from('profiles')
      .select('user_id')
      .eq('email', args.userEmail.toLowerCase())
      .maybeSingle();
    userId = (profileRow as { user_id: string } | null)?.user_id;
    if (!userId) {
      console.warn('[messaging-mirror] no profile found for email:', args.userEmail);
      return null;
    }
  }

  if (userId) {
    const { data: existing } = await service
      .from('message_threads')
      .select('id')
      .eq('kind', 'sweet_dreams')
      .eq('owner_user_id', userId)
      .maybeSingle();
    if (existing) return (existing as { id: string }).id;

    // The signup trigger should have created one already, but if it
    // didn't, fail safe by creating it.
    const { data: created, error } = await service
      .from('message_threads')
      .insert({
        kind: 'sweet_dreams',
        owner_user_id: userId,
        subject: 'Sweet Dreams Music',
      })
      .select('id')
      .single();
    if (error || !created) {
      console.error('[messaging-mirror] could not create Sweet Dreams thread:', error);
      return null;
    }
    await service.from('message_thread_participants').insert({
      thread_id: (created as { id: string }).id,
      user_id: userId,
      role: 'owner',
    });
    return (created as { id: string }).id;
  }

  return null;
}

/**
 * Write a mirror message into the appropriate thread. Fire-and-forget
 * helper — callers shouldn't await it, or should wrap in try/catch.
 *
 * The body is sanitized client-side at render time (escapeHtml in the
 * email helpers). Here we store the raw text — the chat bubble UI
 * renders it via React's text-content escaping, so XSS isn't a vector.
 */
export async function mirrorToThread(args: MirrorArgs): Promise<void> {
  try {
    const threadId = await resolveTargetThread(args);
    if (!threadId) return;

    const service = createServiceClient();
    const body = args.subject ? `${args.subject}\n\n${args.body}` : args.body;

    const { error } = await service.from('messages').insert({
      thread_id: threadId,
      author_user_id: null,
      author_role: 'system',
      kind: args.kind,
      body,
      attachments: args.attachments ?? [],
    });
    if (error) {
      console.error('[messaging-mirror] insert failed:', error);
    }
  } catch (e) {
    console.error('[messaging-mirror] unexpected error:', e);
  }
}
