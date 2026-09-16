/**
 * lib/security/kill-code.ts
 *
 * Time-based one-time code (RFC 6238 TOTP) for the emergency kill switch.
 *
 * The kill switch lets the app OWNER disable or re-enable the whole app
 * WITHOUT a Microsoft 365 sign-in — a manual lever for when the normal auth
 * path itself might be compromised. The only thing a correct code can do is
 * flip the app between "live" and "disabled" (see lib/graph/app-control.ts);
 * it can never read or change any data, so it is fail-closed.
 *
 * Security properties:
 *  - The secret is a server-side environment variable (KILL_SWITCH_SECRET),
 *    base32-encoded, never sent to the browser.
 *  - The 6-digit code is derived fresh on every verification and never
 *    stored or logged.
 *  - Standard TOTP (HMAC-SHA1, 30s period, 6 digits) so the owner can hold
 *    the secret in any authenticator app (Google Authenticator / Authy).
 *  - Verification allows the current 30s step ±1 (90s total) for clock skew.
 *  - Comparison is constant-time.
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const SKEW_STEPS = 1; // accept current step and one on each side

/** Decode an RFC 4648 base32 string (no padding required) to bytes. */
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/,"").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue; // skip anything not in the alphabet
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** One HOTP value for a given counter (RFC 4226). */
function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter. Bitwise ops are 32-bit, so split hi/lo.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/**
 * Verify a supplied code against the current time window. Returns true only
 * if it matches the current 30s step or an adjacent one. Constant-time.
 */
export function verifyKillCode(supplied: string): boolean {
  const secret = env.KILL_SWITCH_SECRET;
  if (!secret) return false;

  const normalized = String(supplied ?? "").replace(/\D/g, "");
  if (normalized.length !== DIGITS) return false;

  const key = base32Decode(secret);
  if (key.length === 0) return false;

  const step = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
  const suppliedBuf = Buffer.from(normalized);

  let matched = false;
  // Always evaluate every candidate (no early return) so timing does not
  // reveal which step matched.
  for (let i = -SKEW_STEPS; i <= SKEW_STEPS; i++) {
    const candidate = Buffer.from(hotp(key, step + i));
    if (
      candidate.length === suppliedBuf.length &&
      timingSafeEqual(candidate, suppliedBuf)
    ) {
      matched = true;
    }
  }
  return matched;
}
