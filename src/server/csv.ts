export function safeCell(value: unknown) {
  const s = String(value ?? '');
  return /^[\s]*[=+\-@\t\r\n]/.test(s) ? `'${s}` : s;
}
const stamp = (n: number | null) => n ? new Date(n).toLocaleString('sv-SE',{timeZone:'Asia/Manila'}) : '';
type Row = Record<string,unknown>;
const columns: [string,(r:Row)=>unknown][] = [
  ['player_id',r=>r.id],['name',r=>r.name],['mobile',r=>r.mobile],['email',r=>r.email],['company',r=>r.company],['role',r=>r.role],
  ['industry',r=>r.industry],['campaign_challenge',r=>r.challenge],['planning_6_months',r=>r.planning],['marketing_optin',r=>r.marketing_optin],
  ['consent_version',r=>r.consent_version],['consent_at_manila',r=>stamp(r.consent_at as number)],['audience',r=>r.audience_id],
  ['wants_simulation',r=>r.wants_sim],['score',r=>r.score],['correct',r=>r.correct],['persona',r=>r.persona],
  ['claim_code',r=>r.code],['awarded_at_manila',r=>stamp(r.awarded_at as number)],['fulfilled_at_manila',r=>r.draw_outcome==='no_prize'?'':stamp(r.claimed_at as number)],
  ['drawn_at_manila',r=>stamp(r.claimed_at as number)],['prize_day',r=>r.prize_day],['draw_outcome',r=>r.draw_outcome??(r.claimed_at?(r.prize_id?'prize':'legacy'):'pending')],
  ['prize_id',r=>r.prize_id],['prize_name',r=>r.draw_outcome==='no_prize'?'Thank you for playing':r.prize_name??(r.claimed_at?'Previously fulfilled (historical record)':'')],['gcash_amount_php',r=>r.amount_php],['package_value_php',r=>r.value_php],
  ['registered_at_manila',r=>stamp(r.created_at as number)],['finished_at_manila',r=>stamp(r.finished_at as number)]
];
const cell = (value: unknown) => `"${safeCell(value).replaceAll('"','""')}"`;
export function exportCsv(rows: Row[], claimsOnly = false) {
  return '\ufeff'+[columns.map(([name])=>cell(name)).join(','),...rows.filter(r=>!claimsOnly||r.code).map(r=>columns.map(([,get])=>cell(get(r))).join(','))].join('\r\n');
}
