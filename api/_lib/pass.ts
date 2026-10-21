import crypto from 'crypto';

/** scrypt hash for new accounts: "s1$<salt>$<hash>" */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `s1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const safeEq = (a: string, b: string) => {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
};

/**
 * Checks a password against a user_controls document. Supports the scrypt format, the earlier client-side
 * sha256("id:password") format, and the legacy plain-text password. A document with no password at all accepts any input
 * (that is how admin-created codes without a password already worked).
 */
export function verifyPassword(id: string, password: string, doc: { passwordHash?: string; password?: string | null }): boolean {
  const h = doc.passwordHash;
  if (h) {
    if (h.startsWith('s1$')) {
      const [, salt, hash] = h.split('$');
      try {
        const calc = crypto.scryptSync(password, Buffer.from(salt, 'base64'), 32);
        const want = Buffer.from(hash, 'base64');
        return calc.length === want.length && crypto.timingSafeEqual(calc, want);
      } catch { return false; }
    }
    return safeEq(h, crypto.createHash('sha256').update(`${id}:${password}`).digest('hex'));
  }
  if (doc.password && String(doc.password).trim() !== '') return safeEq(String(doc.password).trim(), password.trim());
  return true;
}

export { safeEq };
