export const EVENT_ID = 'digicon2026';
export function config() {
  const demo = process.env.DEMO_MODE === '1';
  const secret = process.env.SESSION_SECRET ?? '';
  const staffPin = process.env.STAFF_PIN ?? '';
  if (secret.length < 32 || !/^\d{4,12}$/.test(staffPin)) throw new Error('Set SESSION_SECRET (32+ characters) and STAFF_PIN (4–12 digits).');
  if (!demo && (secret === 'local-development-secret-replace-before-deploying' || staffPin === '4321')) throw new Error('Replace the local example SESSION_SECRET and STAFF_PIN before deployment.');
  const url = new URL(process.env.PUBLIC_URL || 'http://localhost:3100');
  if (!demo && url.protocol !== 'https:') throw new Error('Production PUBLIC_URL must use HTTPS.');
  return { demo, secret, staffPin, publicUrl: url.origin, eventId: EVENT_ID };
}
