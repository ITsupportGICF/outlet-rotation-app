/**
 * lib/security/password.ts
 *
 * Password hashing for the Admin Center's secondary username/password gate.
 *
 * Why this exists: Admin Center credentials are stored as rows in a
 * SharePoint list (AdminUsers), not a real identity provider, so this file
 * is what stands between "someone can read the list" and "someone has a
 * usable password." A plaintext or weakly-hashed password in a SharePoint
 * list is a real risk even though the data the Admin Center configures
 * (misc amount, active sections) isn't itself sensitive - a compromised
 * admin credential is still a foothold into a production app.
 *
 * We use Node's built-in scrypt (no native dependency to compile/deploy on
 * Azure App Service, unlike bcrypt/argon2 bindings) with a random salt per
 * password and a timing-safe comparison on verify.
 *
 * Stored format: "scrypt:N:r:p:<saltHex>:<hashHex>"
 * Encoding the parameters lets us tune cost later without breaking old
 * hashes, and identifies the algorithm if we ever add a second one.
 */
import "server-only";

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

// util.promisify's automatic overload resolution picks the 3-arg scrypt
// signature (no options). Cast explicitly to the 4-arg (with options) form
// we actually call.
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

// Cost parameters. N=2^15 is comfortably above OWASP's minimum guidance for
// scrypt and takes well under 100ms on typical App Service hardware.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

// Node's scrypt defaults to a 32 MiB memory cap, but N=32768/r=8 needs just
// over that (128 * N * r ≈ 32 MiB plus overhead) and throws "memory limit
// exceeded" without this. maxmem doesn't change the derived hash - only
// whether Node will compute it - so it must be set on BOTH hash and verify.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer;

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    derivedKey.toString("hex"),
  ].join(":");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);

  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");

    const derivedKey = (await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    })) as Buffer;

    if (derivedKey.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(derivedKey, expected);
  } catch {
    // Malformed stored hash, or scrypt parameters rejected - treat as a
    // failed verification, never throw into the caller.
    return false;
  }
}
