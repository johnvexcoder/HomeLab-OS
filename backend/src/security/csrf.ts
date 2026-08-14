import { randomBytes } from './crypto';
import { getBoolSetting } from './settings';

/**
 * Double-submit CSRF protection.
 *
 * On a successful login we set a NON-httpOnly `csrf` cookie (random value).
 * Every state-changing request must send it back as the `X-CSRF-Token`
 * header. An attacker cannot read or set cookie values from another origin,
 * and `SameSite=Lax` blocks most cross-site sends anyway — two independent
 * layers.
 */

export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function generateCsrfToken(): string {
  return randomBytes(16);
}

export function csrfEnabled(): boolean {
  return getBoolSetting('security.csrfProtection');
}

/** True when the token is valid (or CSRF protection is disabled). */
export function validateCsrf(cookieToken: string | undefined, headerToken: string | undefined): boolean {
  if (!csrfEnabled()) return true;
  if (!cookieToken || !headerToken) return false;
  return cookieToken.length === 32 && headerToken.length === 32 && cookieToken === headerToken;
}
