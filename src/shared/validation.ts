export const INDUSTRIES = ['FMCG', 'Banking & fintech', 'Telco', 'Retail & e-commerce', 'QSR & food', 'Agency', 'Other'] as const;
export const CHALLENGES = [
  'Knowing what will work before launch',
  'Making enough creatives',
  'Proving ROI',
  'Reaching the right audience',
] as const;
export const PLANNING = ['Yes', 'Maybe', 'No'] as const;

export interface CampaignInput {
  industry: string;
  challenge: string;
  planning: string;
}
export type CampaignErrors = Partial<Record<keyof CampaignInput, string>>;

export interface SignupInput extends CampaignInput {
  name: string;
  mobile: string;
  email: string;
  company: string;
  role: string;
  consent: boolean;
  optin: boolean;
}
export type SignupErrors = Partial<Record<keyof SignupInput, string>>;

export const SIGNUP_LIMITS = { name:120, mobile:24, email:254, company:120, role:120 } as const;
/** Limits for the compact number shown in the input, including a leading +. */
export const mobileInputLimit = (value: string) => value.startsWith('+') ? 13 : value.startsWith('63') ? 12 : value.startsWith('9') ? 10 : 11;
export const limitMobileInput = (value: string) => {
  const compact = `${value.trimStart().startsWith('+') ? '+' : ''}${value.replace(/\D/g, '')}`;
  return compact.slice(0, mobileInputLimit(compact));
};
export const CLAIM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const normalizeClaimCode = (s: string) => s.trim().toUpperCase();
export const validStaffPin = (s: unknown): s is string => typeof s === 'string' && /^\d{4,12}$/.test(s);
export const normalizeMobile = (s: unknown) => {
  if (typeof s !== 'string') return '';
  const compact = s.trim().replace(/[\s()-]/g, '');
  if (/^(?:\+?63)9\d{9}$/.test(compact)) return `0${compact.slice(-10)}`;
  if (/^9\d{9}$/.test(compact)) return `0${compact}`;
  return compact;
};

const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
export function validateCampaign(raw: Record<string, unknown>): { value: CampaignInput; errors: CampaignErrors } {
  const value = { industry: text(raw.industry), challenge: text(raw.challenge), planning: text(raw.planning) };
  const errors: CampaignErrors = {};
  if (!(INDUSTRIES as readonly string[]).includes(value.industry)) errors.industry = 'Choose an industry.';
  if (!(CHALLENGES as readonly string[]).includes(value.challenge)) errors.challenge = 'Pick one.';
  if (!(PLANNING as readonly string[]).includes(value.planning)) errors.planning = 'Pick one.';
  return { value, errors };
}
const controls = /\p{Cc}/u;
const validEmail = (email: string) => {
  const local = email.split('@')[0];
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(email);
};

export function validateSignup(raw: Record<string, unknown>, source: 'phone' | 'tv' = 'phone'): { value: SignupInput; errors: SignupErrors } {
  const value: SignupInput = {
    name: text(raw.name),
    mobile: normalizeMobile(raw.mobile),
    email: text(raw.email).toLowerCase(),
    company: text(raw.company),
    role: text(raw.role),
    industry: text(raw.industry),
    challenge: text(raw.challenge),
    planning: text(raw.planning),
    consent: raw.consent === true,
    optin: source === 'phone' && raw.optin === true,
  };
  const e: SignupErrors = {};
  if (!value.name) e.name = 'Enter your full name.';
  else if (value.name.length < 2 || !/\p{L}/u.test(value.name) || controls.test(value.name)) e.name = 'Enter a name with at least two characters.';
  if (!/^09\d{9}$/.test(value.mobile) || typeof raw.mobile !== 'string' || raw.mobile.length > SIGNUP_LIMITS.mobile) e.mobile = 'Enter a PH mobile number: 09XXXXXXXXX or +639XXXXXXXXX.';
  if (!validEmail(value.email)) e.email = 'Enter a valid email address.';
  if (!value.company || controls.test(value.company) || !/[\p{L}\p{N}]/u.test(value.company)) e.company = 'Enter your company.';
  if (!value.role || controls.test(value.role) || !/\p{L}/u.test(value.role)) e.role = 'Enter your role.';
  for (const field of ['name','email','company','role'] as const) {
    if (value[field].length > SIGNUP_LIMITS[field]) e[field] = `Use ${SIGNUP_LIMITS[field]} characters or fewer.`;
  }
  // Older clients can still supply valid campaign answers at signup.
  // New clients leave them empty and collect them after gameplay.
  const campaignErrors = validateCampaign(raw).errors;
  for (const field of ['industry', 'challenge', 'planning'] as const) {
    if (raw[field] !== undefined && raw[field] !== '' && campaignErrors[field]) e[field] = campaignErrors[field];
  }
  if (!value.consent) e.consent = 'Consent is required to play.';
  if (raw.optin !== undefined && typeof raw.optin !== 'boolean') e.optin = 'Choose whether to receive marketing updates.';
  return { value, errors: e };
}
