import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Audience, ContentPayload } from '../shared/types';

export const CONSENT_VERSION = 'placeholder-prize-consent-v2';
export const CONSENT_TEXT = 'I agree to AdSpark and Predikta processing my registration details and game responses to operate this booth game and arrange my prize. Marketing updates require separate consent.';
export const manilaDate = (now: number) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
export const manilaStart = (now: number) => Date.parse(`${manilaDate(now)}T00:00:00+08:00`);
/** Legacy schedule validation, retained for historical imports; prize seeding no longer reads this. */
export interface Schedule { totalCap: number; days: string[]; blocks: { start: string; end: string; allocation: number }[] }
export interface StoredContent { id: string; audiences: Audience[]; respondents: string[] }
export function validateContent(audiences: Audience[], respondents: string[]) {
  if (!Array.isArray(audiences) || audiences.length !== 3 || !Array.isArray(respondents) || respondents.some(r=>typeof r!=='string'||!r.trim())) throw new Error('Content requires three audiences and valid respondent labels.');
  if (new Set(audiences.map(a => a.id)).size !== 3) throw new Error('Audience IDs must be unique.');
  for (const a of audiences) {
    if (!a.id || !a.name || !a.meta || !Array.isArray(a.chips) || !Array.isArray(a.rounds) || ![3,5].includes(a.rounds.length)) throw new Error('Invalid audience.');
    for (const r of a.rounds) {
      if (!['a','b'].includes(r.winner) || !r.brand || !r.product || !r.objective ||
          (r.insightSource !== undefined && r.insightSource !== 'illustrative') ||
          !Array.isArray(r.reactions) || ![0,2].includes(r.reactions.length) || r.reactions.some(text=>typeof text!=='string'||!text.trim()) ||
          (r.reactions.length>0 && !respondents.length) ||
          [r.emotion,r.driver].some(text=>text!==null && (typeof text!=='string'||!text.trim()))) throw new Error('Invalid round result.');
      if (r.split !== null && (!r.split || !Number.isFinite(r.split.a) || !Number.isFinite(r.split.b) ||
          r.split.a <= 0 || r.split.b <= 0 || r.split.a + r.split.b !== 100 || r.split[r.winner] <= 50)) throw new Error('Invalid preference split.');
      for (const ad of [r.a,r.b]) {
        if (!ad.copy || !ad.visual || (ad.image !== undefined && (typeof ad.image!=='string' || !/^\/content\/ads\/[\w.-]+\.(webp|png|jpe?g)$/i.test(ad.image)))) throw new Error('Invalid ad.');
      }
    }
  }
}
export function scheduleRows(s: Schedule) {
  if (!Number.isInteger(s.totalCap) || s.totalCap < 0 || s.totalCap > 300 || !s.days.length || !s.blocks.length) throw new Error('Invalid GC cap/schedule.');
  if (s.days.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0,10) !== d) ||
      s.blocks.some(b => !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.end))) throw new Error('Invalid calendar day or time.');
  const rows = s.days.flatMap(day => s.blocks.map(b => ({
    id: `${day}T${b.start}`, starts: Date.parse(`${day}T${b.start}:00+08:00`), ends: Date.parse(`${day}T${b.end}:00+08:00`), allocation: b.allocation
  }))).sort((a,b) => a.starts-b.starts);
  if (new Set(rows.map(r => r.id)).size !== rows.length || rows.some((r,i) => !Number.isFinite(r.starts) ||
      !Number.isFinite(r.ends) || r.ends <= r.starts || !Number.isInteger(r.allocation) || r.allocation < 0 || (i > 0 && r.starts < rows[i-1].ends))) throw new Error('Invalid or overlapping GC blocks.');
  if (rows.reduce((n,r) => n+r.allocation,0) > s.totalCap) throw new Error('GC schedule exceeds the cap.');
  return rows;
}
export async function loadSeed(demo: boolean) {
  const read = async (file: string) => JSON.parse(await readFile(join(process.cwd(), 'content', file), 'utf8'));
  const audiences = await read('audiences.json') as Audience[];
  const respondents = await read('respondents.json') as string[];
  validateContent(audiences, respondents);
  const id = createHash('sha256').update(JSON.stringify({ audiences, respondents })).digest('hex');
  const approval = demo ? { consentVersion: CONSENT_VERSION, consentText: CONSENT_TEXT } : await read('approval.json');
  if (!demo && (!approval.approved || !approval.consentVersion || !approval.consentText || !approval.contentApproved || audiences.some(a => a.rounds.some(r => !r.a.image || !r.b.image)))) throw new Error('Production seed requires approved content and consent in content/approval.json.');
  for (const a of audiences) for (const r of a.rounds) for (const ad of [r.a,r.b]) if (ad.image) await readFile(join(process.cwd(), 'public', ad.image.slice(1)));
  return { content: { id, audiences, respondents }, consentVersion: approval.consentVersion as string, consentText: approval.consentText as string };
}
export function publicContent(c: StoredContent, publicUrl: string, demo: boolean, consentText: string, consentVersion: string,
  links: { contactUrl?: string; privacyPolicyUrl?: string | null } = {}): ContentPayload {
  return { version: c.id, demo, consentText, consentVersion, joinUrl: `${publicUrl}/play`,
    contactUrl: links.contactUrl ?? 'https://www.adspark.ph/get-in-touch', privacyPolicyUrl: links.privacyPolicyUrl ?? 'https://www.adspark.ph/privacy-policy',
    audiences: c.audiences.map(a => ({ ...a, rounds: a.rounds.map(r => ({ brand: r.brand, product: r.product, objective: r.objective, a: r.a, b: r.b })) })) };
}
