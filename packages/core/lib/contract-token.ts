// lib/contract-token.ts
//
// NO-LOGIN CONTRACT LINK — token generation.
//
// A media_bookings.public_token is the ONLY credential for the public,
// unauthenticated contract surface (/contract/[token]). Whoever holds a token
// can view/sign/pay exactly ONE booking and nothing else, so the token must be
// long and unguessable.
//
// crypto.randomBytes(24) → 24 bytes of CSPRNG entropy, hex-encoded to 48 chars
// (192 bits of entropy; well above the >= 32-char floor). This mirrors the
// pgcrypto backfill in supabase-migrations/090_contract_public_token.sql, which
// uses encode(gen_random_bytes(24),'hex') for the same 48-hex-char shape.
//
// Server-only: imports node:crypto. Never import this into client code.

import { randomBytes } from 'crypto';

/**
 * Mint a fresh contract public token: 48 hex chars of crypto-random entropy.
 * Collision-resistant; uniqueness is additionally enforced by a UNIQUE index on
 * media_bookings(public_token).
 */
export function generateContractPublicToken(): string {
  return randomBytes(24).toString('hex');
}
