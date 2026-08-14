import { getIntSetting, getBoolSetting } from './settings';

/**
 * Enforced password policy. Returns an error message string, or null if the
 * password passes. Policies are configurable via security settings.
 */
export function passwordStrength(password: string): string | null {
  const minLength = Math.max(8, getIntSetting('security.passwordPolicyMinLength', 10));
  if (password.length < minLength) {
    return `Password must be at least ${minLength} characters.`;
  }
  if (getBoolSetting('security.passwordPolicyRequireSymbol')) {
    if (!/[^A-Za-z0-9]/.test(password)) {
      return 'Password must contain at least one symbol.';
    }
  }
  // Reject extreme common patterns cheaply.
  if (/^(.)\1{7,}$/.test(password)) {
    return 'Password is too repetitive.';
  }
  if (/(0123456789|9876543210|qwerty|password|homelab|admin)/i.test(password)) {
    return 'Password contains a common word or sequence.';
  }
  return null;
}
