'use client';
// The game, shared by the player phone and the big TV. Only the layout differs (see tv.css).
// The server is authoritative: we send pick + confidence + time, it returns the reveal and points.
import { useEffect, useRef, useState } from 'react';
import type { ConfIdx, ContentPayload, Me, Reveal, Side } from '../../shared/types';
import { CONF, PERSONAS, ROUND_SECS } from '../../shared/rules';
import { CHALLENGES, INDUSTRIES, PLANNING, SIGNUP_LIMITS, normalizeMobile, validateSignup, type SignupErrors, type SignupInput } from '../../shared/validation';
import { api, ApiError } from '../../lib/api';
import { fmt, manilaTime } from '../../lib/hooks';
import { AdCard, Brand, Dots, Qr, SplitBar, Wallet } from './bits';
import { MobileInput } from './MobileInput';

export type Variant = 'phone' | 'tv';
type Screen = 'landing' | 'signup' | 'howto' | 'audience' | 'round' | 'reveal' | 'results' | 'claim';

interface State {
  screen: Screen;
  token: string | null;
  me: Me | null;
  form: Partial<SignupInput>;
  formKey: number;
  errors: SignupErrors & { dupe?: boolean };
  r: number;
  pick: Side | null;
  conf: ConfIdx;
  t0: number;
  timeLeft: number;
  locked: boolean;
  reveal: Reveal | null;
  wallet: number;
  modal: Side | null;
  busy: boolean;
  net: { msg: string; retry?: () => void } | null;
}

const fresh = (): State => ({
  screen: 'landing', token: null, me: null, form: {}, formKey: 0, errors: {}, r: 0, pick: null, conf: 1, t0: 0,
  timeLeft: ROUND_SECS, locked: false, reveal: null, wallet: 0, modal: null, busy: false, net: null,
});

const TOKEN_KEY = 'otc.token';
const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode: the game still works, it just can't resume after a reload */
    }
  },
};

/** TV only: return to the attract screen after this long without a touch. */
const TV_IDLE_MS = 90_000;

interface Props {
  variant: Variant;
  content: ContentPayload;
  gcLeftToday: number | null;
  onPlayer?: (id: string | null) => void;
  onAccessDenied?: () => void;
}

export function Game({ variant, content: initialContent, gcLeftToday, onPlayer, onAccessDenied }: Props) {
  const [s, setState] = useState<State>(fresh);
  const ref = useRef<State>(s);
  const screenEl = useRef<HTMLDivElement>(null);
  const modalTrigger = useRef<HTMLButtonElement | null>(null);
  const content = s.me?.content ?? initialContent;
  const generation = useRef(0);
  const signupPending = useRef<{ key: string; body: Record<string, unknown> } | null>(null);
  const pendingLock = useRef<{ r: number; body: Record<string, unknown> } | null>(null);
  const refreshInFlight = useRef(false);
  const persist = variant === 'phone';

  const patch = (p: Partial<State>) => {
    ref.current = { ...ref.current, ...p };
    setState(ref.current);
  };
  const toTop = () => {
    screenEl.current?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  };
  const go = (screen: Screen) => {
    patch({ screen, modal: null, busy: false });
    toTop();
  };
  const closeModal = () => {
    patch({ modal: null });
    requestAnimationFrame(() => modalTrigger.current?.focus());
  };
  const reset = () => {
    if (persist) { tokenStore.set(null); try { localStorage.removeItem('otc.pendingSignup'); localStorage.removeItem('otc.pendingLock'); } catch {} }
    generation.current++;
    signupPending.current = null; pendingLock.current = null;
    ref.current = fresh();
    onPlayer?.(null);
    setState(ref.current);
  };

  const call = async <T,>(path: string, body?: unknown, retries = 3): Promise<T> => {
    const epoch = generation.current;
    try {
      const res = await api<T>(variant === 'tv' ? path.replace('/api/','/api/tv/') : path, {
        body, token: ref.current.token, retries,
        onRetry: () => { if (epoch === generation.current) patch({ net: { msg: 'Weak connection. Retrying…' } }); },
      });
      if (epoch !== generation.current) throw new Error('stale_game');
      if (ref.current.net) patch({ net: null });
      return res;
    } catch (e) {
      if (epoch !== generation.current) throw new Error('stale_game', { cause: e });
      throw e;
    }
  };
  /** Unknown token (e.g. the database was reset): start over. */
  const lostPlayer = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      if (variant === 'tv' && e.code === 'tv_required') { onAccessDenied?.(); return true; }
      reset();
      return true;
    }
    return false;
  };
  const fail = (e: unknown, msg: string, retry: () => void) => {
    if (e instanceof Error && e.message === 'stale_game') return;
    if (lostPlayer(e)) return;
    patch({ busy: false, net: { msg, retry } });
  };

  // ---- flow ----

  const focusSignupError = (errors: SignupErrors) => requestAnimationFrame(() => {
    const field = Object.keys(errors).find(key => errors[key as keyof SignupErrors]);
    const input = field ? screenEl.current?.querySelector<HTMLElement>(`[name="${field}"]`) : null;
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: 'center', behavior: 'instant' });
  });

  async function submitSignup(form: SignupInput) {
    if (ref.current.busy) return;
    const { value, errors } = validateSignup(form as unknown as Record<string, unknown>);
    if (Object.keys(errors).length) {
      patch({ form, errors });
      focusSignupError(errors);
      return;
    }
    patch({ form: value, errors: {}, busy: true });
    const epoch = generation.current;
    try {
      const body = { ...value, source: variant, contentVersion: content.version, consentVersion: content.consentVersion };
      if (!signupPending.current || JSON.stringify(signupPending.current.body) !== JSON.stringify(body)) {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        signupPending.current = { key: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''), body };
      }
      if (persist) { try { localStorage.setItem('otc.pendingSignup', JSON.stringify(signupPending.current)); } catch {} }
      const { token, me } = await api<{ token: string; me: Me }>(variant === 'tv' ? '/api/tv/players' : '/api/players', { body, retries: 3, idempotencyKey: signupPending.current.key });
      if (epoch !== generation.current) return;
      signupPending.current = null;
      if (persist) { try { localStorage.removeItem('otc.pendingSignup'); } catch {} }
      if (persist) tokenStore.set(token);
      onPlayer?.(me.id);
      patch({ token, me, wallet: 0 });
      go('howto');
    } catch (e) {
      if (epoch !== generation.current) return;
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        signupPending.current = null;
        if (persist) { try { localStorage.removeItem('otc.pendingSignup'); } catch {} }
      }
      if (e instanceof ApiError && e.code === 'duplicate_mobile') {
        const errors = { mobile: 'This mobile number has already played. One play per number.' };
        patch({ busy: false, errors });
        focusSignupError(errors);
      } else if (e instanceof ApiError && e.status === 409) {
        fail(e, 'Game content changed. Reload to start with the latest content.', () => window.location.reload());
      } else if (e instanceof ApiError && e.status === 400) {
        const errors = (e.data.errors ?? {}) as SignupErrors;
        patch({ busy: false, errors });
        focusSignupError(errors);
      } else {
        fail(e, 'Could not reach the booth. Check your connection and try again.', () => submitSignup(form));
      }
    }
  }

  async function chooseAudience(audienceId: string) {
    patch({ busy: true });
    try {
      const me = await call<Me>('/api/game/audience', { audienceId });
      patch({ me });
      await startRound(0);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'audience_locked') return resume();
      fail(e, 'Could not start the game.', () => chooseAudience(audienceId));
    }
  }

  async function startRound(i: number) {
    patch({ busy: true });
    try {
      const { elapsedMs, locked } = await call<{ elapsedMs: number; locked: boolean }>(`/api/game/rounds/${i}/start`, {});
      if (locked) return sendLock(i, {});
      const pending = pendingLock.current;
      if (pending && pending.r === i) return sendLock(i, pending.body);
      patch({
        screen: 'round', r: i, pick: null, conf: 1, t0: Date.now() - elapsedMs,
        timeLeft: Math.max(0, ROUND_SECS - elapsedMs / 1000), locked: false, reveal: null, modal: null, busy: false,
      });
      toTop();
    } catch (e) {
      fail(e, 'Could not start the round.', () => startRound(i));
    }
  }

  function lockIn() {
    const st = ref.current;
    if (st.screen !== 'round' || st.locked) return;
    patch({ locked: true });
    sendLock(st.r, { pick: st.pick, conf: st.conf, clientMs: Math.min(ROUND_SECS * 1000, Date.now() - st.t0) });
  }

  async function sendLock(r: number, body: Record<string, unknown>) {
    if ('pick' in body) {
      pendingLock.current = { r, body };
      if (persist) { try { localStorage.setItem('otc.pendingLock', JSON.stringify(pendingLock.current)); } catch {} }
    }
    patch({ busy: true });
    try {
      const reveal = await call<Reveal>(`/api/game/rounds/${r}/lock`, body, 4);
      pendingLock.current = null;
      if (persist) { try { localStorage.removeItem('otc.pendingLock'); } catch {} }
      patch({ reveal, r, wallet: reveal.wallet });
      go('reveal');
    } catch (e) {
      fail(e, "Your pick hasn't reached the booth yet. Tap Retry; it's kept.", () => sendLock(r, body));
    }
  }

  async function finish() {
    patch({ busy: true });
    try {
      const me = await call<Me>('/api/game/finish', {});
      patch({ me, wallet: me.wallet });
      go('results');
    } catch (e) {
      fail(e, 'Could not save your results.', finish);
    }
  }

  async function toggleSim(wants = !ref.current.me?.wantsSim) {
    if (!ref.current.me) return;
    patch({ busy: true });
    try {
      patch({ me: await call<Me>('/api/game/sim', { wants }), busy: false });
    } catch (e) {
      fail(e, 'Could not save your interest. Tap Retry.', () => toggleSim(wants));
    }
  }

  async function refreshMe(retryAward = false) {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const epoch = generation.current;
    if (retryAward) patch({ busy: true });
    try {
      const me = retryAward ? await call<Me>('/api/game/claim/retry', {}, 1) : await call<Me>('/api/me', undefined, 0);
      patch({ me });
    } catch (e) {
      fail(e, 'Could not check your claim. Tap Retry.', () => refreshMe(retryAward));
    } finally {
      refreshInFlight.current = false;
      if (retryAward && epoch === generation.current) patch({ busy: false });
    }
  }

  /** Pick up where this device left off (phone reloads, Wi-Fi drops). */
  async function resume() {
    try {
      const me = await call<Me>('/api/me');
      patch({ me, wallet: me.wallet });
      onPlayer?.(me.id);
      if (me.finished) return go(me.gc?.status === 'awarded' ? 'claim' : 'results');
      if (me.startedRound) return startRound(me.startedRound.idx);
      if (me.rounds.length === 3) return finish();
      if (me.rounds.length > 0) return sendLock(me.rounds.length - 1, {}); // already locked: returns the stored reveal
      go(me.audienceId ? 'audience' : 'howto');
    } catch (e) {
      fail(e, 'Could not reach the booth.', resume);
    }
  }

  useEffect(() => {
    if (!persist) return;
    try {
      const saved = JSON.parse(localStorage.getItem('otc.pendingLock') || 'null');
      if (saved && Number.isInteger(saved.r) && saved.r >= 0 && saved.r <= 2 && saved.body &&
        [null,'a','b'].includes(saved.body.pick) && [0,1,2].includes(saved.body.conf) &&
        typeof saved.body.clientMs === 'number' && Number.isFinite(saved.body.clientMs) && saved.body.clientMs >= 0) pendingLock.current = saved;
      else localStorage.removeItem('otc.pendingLock');
    } catch { try { localStorage.removeItem('otc.pendingLock'); } catch {} }
    try {
      const saved = JSON.parse(localStorage.getItem('otc.pendingSignup') || 'null');
      if (saved && typeof saved.key === 'string' && /^[\w-]{32,100}$/.test(saved.key) && saved.body &&
        typeof saved.body === 'object' && !Array.isArray(saved.body) && !Object.keys(validateSignup(saved.body).errors).length &&
        saved.body.source === 'phone' && typeof saved.body.contentVersion === 'string' && typeof saved.body.consentVersion === 'string') signupPending.current = saved;
      else localStorage.removeItem('otc.pendingSignup');
    } catch { try { localStorage.removeItem('otc.pendingSignup'); } catch {} }
    const token = tokenStore.get();
    if (!token) {
      if (signupPending.current) {
        patch({ form: signupPending.current.body as unknown as SignupInput, screen: 'signup', formKey: 1 });
      }
      return;
    }
    patch({ token, busy: true });
    resume();
  }, []);

  // Round timer. Running out locks in whatever is selected, or a timeout if nothing is.
  useEffect(() => {
    if (s.screen !== 'round' || s.locked) return;
    const id = setInterval(() => {
      const left = Math.max(0, ROUND_SECS - (Date.now() - ref.current.t0) / 1000);
      patch({ timeLeft: left });
      if (left <= 0) lockIn();
    }, 200);
    return () => clearInterval(id);
  }, [s.screen, s.locked, s.r]);

  // Claim screen: watch for staff marking the GC claimed.
  useEffect(() => {
    if (s.screen !== 'claim' || s.me?.gc?.status !== 'awarded' || s.me.gc.claimed) return;
    const id = setInterval(() => refreshMe(), 5000);
    return () => clearInterval(id);
  }, [s.screen, s.me?.gc?.status, s.me?.gc?.status === 'awarded' && s.me.gc.claimed]);

  // TV: back to the attract screen when a walk-up player leaves mid-game.
  useEffect(() => {
    if (variant !== 'tv') return;
    let last = Date.now();
    const touch = () => (last = Date.now());
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    const id = setInterval(() => {
      const st = ref.current.screen;
      if (st !== 'landing' && st !== 'round' && Date.now() - last > TV_IDLE_MS) reset();
    }, 5000);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!s.modal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
      if (e.key === 'Tab') {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>('.modal button:not([tabindex="-1"])')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [s.modal]);

  // ---- screens ----

  const audience = content.audiences.find((a) => a.id === s.me?.audienceId) ?? null;
  const round = audience?.rounds[s.r];

  function Landing() {
    return (
      <>
        <div className="hero">
          <i className="orb" />
          <i className="orb two" />
          <span className="eyebrow">AdSpark × Predikta · Digicon 2026</span>
          <h1>
            Outguess
            <br />
            <em>the crowd.</em>
          </h1>
          <p>Think you know Filipino consumers better? Pick the ad the audience prefers. Reveal audience preferences and reactions.</p>
        </div>
        <div className="facts">
          <div className="fact"><b>3</b><span>rounds</span></div>
          <div className="fact"><b>~3</b><span>minutes</span></div>
          <div className="fact"><b>₱</b><span>GCash GC</span></div>
        </div>
        <div className="gcleft">
          <b>{gcLeftToday ?? '–'}</b>
          <span>GCash GCs left today. Finish all rounds to qualify, while supplies last.</span>
        </div>
        <div className="spacer" />
        <button className="btn spark" disabled={s.busy || !!s.token} onClick={() => go('signup')}>
          {s.token ? 'Resuming your game…' : variant === 'tv' ? 'Tap to play here' : 'Start playing'}
        </button>
        <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>One play per mobile number.</p>
        <p className="tagline">
          <span><b className="pk">Predikta</b> informs the decision.</span>
          <span><b className="as">AdSpark</b> activates the strategy.</span>
        </p>
      </>
    );
  }

  function Signup() {
    const f = s.form;
    const e = s.errors;
    const fieldAttrs = (field: keyof SignupInput) => ({
      id: `signup-${field}`, required: field !== 'optin', disabled: s.busy,
      'aria-invalid': !!e[field], 'aria-describedby': e[field] ? `signup-${field}-error` : undefined,
    });
    const clearFieldError = (ev: React.SyntheticEvent<HTMLFormElement>) => {
      const target: EventTarget = ev.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      const field = target.name as keyof SignupInput;
      if (ref.current.errors[field]) {
        const errors = { ...ref.current.errors };
        delete errors[field];
        patch({ errors });
      }
    };
    const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget as HTMLFormElement);
      const g = (k: string) => String(fd.get(k) ?? '').trim();
      submitSignup({
        name: g('name'), mobile: normalizeMobile(g('mobile')), email: g('email'), company: g('company'), role: g('role'),
        industry: g('industry'), challenge: g('challenge'), planning: g('planning'), consent: fd.get('consent') === 'on', optin: fd.get('optin') === 'on',
      });
    };
    return (
      <>
        <div>
          <span className="eyebrow">Step 1 of 3</span>
          <h2 style={{ fontSize: '26px', marginTop: '4px' }}>Tell us who’s playing</h2>
        </div>
        {e.dupe && <div className="errbox">This mobile number has already played. One play per number.</div>}
        {Object.values(e).some(Boolean) && <div className="errbox" role="alert">Please correct the highlighted fields to continue.</div>}
        <form key={s.formKey} onSubmit={onSubmit} noValidate aria-busy={s.busy} onChange={clearFieldError} onPaste={clearFieldError}>
          <label className="f">Full name<input name="name" {...fieldAttrs('name')} maxLength={SIGNUP_LIMITS.name} defaultValue={f.name} autoComplete="name" />{e.name && <span className="err" id="signup-name-error">{e.name}</span>}</label>
          <label className="f">
            Mobile number (GCash)
            <MobileInput name="mobile" {...fieldAttrs('mobile')} autoComplete="tel" placeholder="09171234567" defaultValue={f.mobile} />
            {e.mobile && <span className="err" id="signup-mobile-error">{e.mobile}</span>}
          </label>
          <label className="f">Work email<input name="email" {...fieldAttrs('email')} maxLength={SIGNUP_LIMITS.email} type="email" autoComplete="email" defaultValue={f.email} />{e.email && <span className="err" id="signup-email-error">{e.email}</span>}</label>
          <div className="two">
            <label className="f">Company<input name="company" {...fieldAttrs('company')} maxLength={SIGNUP_LIMITS.company} autoComplete="organization" defaultValue={f.company} />{e.company && <span className="err" id="signup-company-error">{e.company}</span>}</label>
            <label className="f">Role<input name="role" {...fieldAttrs('role')} maxLength={SIGNUP_LIMITS.role} autoComplete="organization-title" defaultValue={f.role} />{e.role && <span className="err" id="signup-role-error">{e.role}</span>}</label>
          </div>
          <label className="f">
            Industry
            <select name="industry" {...fieldAttrs('industry')} defaultValue={f.industry ?? ''}>
              <option value="">Choose…</option>
              {INDUSTRIES.map((o) => <option key={o}>{o}</option>)}
            </select>
            {e.industry && <span className="err" id="signup-industry-error">{e.industry}</span>}
          </label>
          <fieldset disabled={s.busy}>
            <legend>Biggest campaign challenge?</legend>
            {CHALLENGES.map((c) => (
              <label className="opt" key={c}><input type="radio" name="challenge" required disabled={s.busy} aria-invalid={!!e.challenge} aria-describedby={e.challenge ? 'signup-challenge-error' : undefined} value={c} defaultChecked={f.challenge === c} /><span>{c}</span></label>
            ))}
            {e.challenge && <span className="err" id="signup-challenge-error">{e.challenge}</span>}
          </fieldset>
          <fieldset disabled={s.busy}>
            <legend>Planning a campaign in the next 6 months?</legend>
            <div>
              {PLANNING.map((c) => (
                <label className="opt" key={c} style={{ display: 'inline-flex', marginRight: '14px' }}>
                  <input type="radio" name="planning" required disabled={s.busy} aria-invalid={!!e.planning} aria-describedby={e.planning ? 'signup-planning-error' : undefined} value={c} defaultChecked={f.planning === c} /><span>{c}</span>
                </label>
              ))}
            </div>
            {e.planning && <span className="err" id="signup-planning-error">{e.planning}</span>}
          </fieldset>
          <label className="opt">
            <input type="checkbox" name="consent" {...fieldAttrs('consent')} defaultChecked={f.consent} />
            <span>{content.consentText} <b>(Required)</b></span>
          </label>
          {e.consent && <span className="err" id="signup-consent-error">{e.consent}</span>}
          <label className="opt">
            <input type="checkbox" name="optin" {...fieldAttrs('optin')} defaultChecked={f.optin} />
            <span>Send me AdSpark and Predikta updates. (Optional)</span>
          </label>
          {e.optin && <span className="err" id="signup-optin-error">{e.optin}</span>}
          <button className="btn spark" type="submit" disabled={s.busy}>{s.busy ? 'Saving…' : 'Continue'}</button>
        </form>
      </>
    );
  }

  function HowTo() {
    return (
      <>
        <div>
          <span className="eyebrow">Step 2 of 3</span>
          <h2 style={{ fontSize: '26px', marginTop: '4px' }}>How to play</h2>
        </div>
        <ol className="steps">
          <li><span>You’ll see a target audience and two ads.</span></li>
          <li><span>Pick the one they’ll prefer. Set your confidence.</span></li>
          <li><span>Reveal audience preferences and reactions.</span></li>
        </ol>
        <table className="ptable">
          <thead><tr><th>Points</th>{CONF.map((c) => <th key={c.label}>{c.label}</th>)}</tr></thead>
          <tbody>
            <tr><td>Correct</td>{CONF.map((c) => <td key={c.label}>{c.ok}</td>)}</tr>
            <tr><td>Wrong</td>{CONF.map((c) => <td key={c.label}>{c.no}</td>)}</tr>
          </tbody>
        </table>
        <p className="small muted" style={{ margin: 0 }}>Correct picks earn +1 point per second left on the 30-second timer.</p>
        <div className="spacer" />
        <button className="btn" onClick={() => go('audience')}>Choose an audience</button>
      </>
    );
  }

  function AudienceScreen() {
    return (
      <>
        <div>
          <span className="eyebrow">Step 3 of 3</span>
          <h2 style={{ fontSize: '26px', marginTop: '4px' }}>Who are you reading today?</h2>
        </div>
        {content.audiences.map((a) => (
          <button key={a.id} className="aud" disabled={s.busy} onClick={() => chooseAudience(a.id)}>
            <span className="go">Play →</span>
            <h3>{a.name}</h3>
            <span className="small muted">{a.meta}</span>
            <span className="chips">{a.chips.map((c) => <span className="chip" key={c}>{c}</span>)}</span>
          </button>
        ))}
      </>
    );
  }

  function RoundScreen() {
    if (!audience || !round) return null;
    const pct = (s.timeLeft / ROUND_SECS) * 100;
    return (
      <>
        <div className="rhead"><span className="eyebrow">Round {s.r + 1} of 3</span><Dots r={s.r} /></div>
        <div className="rt">
          <div className="brief"><span className="eyebrow">{audience.name}</span><b>{round.product}</b><span>{round.objective}</span></div>
          <div className="timer" role="timer" aria-label={`${Math.ceil(s.timeLeft)} seconds left`}>
            <div className="track"><div className={`fill ${s.timeLeft < 10 ? 'low' : ''}`} style={{ width: `${pct}%` }} /></div>
            <b>{Math.ceil(s.timeLeft)}s</b>
          </div>
        </div>
        <div className="pair">
          {(['a', 'b'] as const).map((k) => (
            <div className="adwrap" key={k}>
              <AdCard
                ad={round[k]} brand={round.brand} label={k.toUpperCase()}
                cls={s.pick === k ? 'sel' : s.pick ? 'dim' : ''} pressed={s.pick === k} inert={s.locked}
                onClick={() => !s.locked && patch({ pick: k })}
              />
              <button className="enl" disabled={s.locked} onClick={(e) => { modalTrigger.current = e.currentTarget; patch({ modal: k }); }}>Enlarge {k.toUpperCase()}</button>
            </div>
          ))}
        </div>
        <div className="rb">
          <span className="eyebrow">How sure are you?</span>
          <div className="conf">
            {CONF.map((c, i) => (
              <button key={c.label} disabled={s.locked} aria-pressed={s.conf === i} onClick={() => !s.locked && patch({ conf: i as ConfIdx })}>
                {c.label}<span>{c.ok} pts</span>
              </button>
            ))}
          </div>
          <button className="btn spark" disabled={!s.pick || s.locked} onClick={lockIn}>
            {s.locked ? 'Locking in…' : s.pick ? `Lock in Ad ${s.pick.toUpperCase()}` : 'Tap an ad to pick'}
          </button>
        </div>
      </>
    );
  }

  function RevealScreen() {
    const rv = s.reveal;
    if (!audience || !round || !rv) return null;
    const res = rv.result;
    return (
      <>
        <div className="rhead">
          <span className="eyebrow">Round {rv.idx + 1} reveal{rv.surprise ? ' · surprise round' : ''}</span>
          <Dots r={rv.idx} />
        </div>
        {!res.pick ? (
          <div className="verdict no"><h2>Time’s up</h2><span className="pts">+0 pts</span></div>
        ) : res.correct ? (
          <div className="verdict ok"><h2>You read the crowd.</h2><span className="pts">+{res.points} pts · +{res.bonus} speed bonus</span></div>
        ) : (
          <div className="verdict no"><h2>The crowd went the other way.</h2><span className="pts">+{res.points} pts</span></div>
        )}
        <div className="pair">
          {(['a', 'b'] as const).map((k) => (
            <AdCard key={k} ad={round[k]} brand={round.brand} label={k.toUpperCase()} cls={k === rv.winner ? 'win' : 'dim'} inert />
          ))}
        </div>
        <div className="rs">
          <div className="split">
            <span className="eyebrow">Audience preference</span>
            <SplitBar winner={rv.winner} split={rv.split} />
          </div>
          <div className="insight">
            <div><span className="eyebrow">Top emotion</span><b>{rv.emotion}</b></div>
            <div><span className="eyebrow">Your pick</span><b>{res.pick ? `Ad ${res.pick.toUpperCase()} · ${CONF[res.conf].label}` : 'No pick'}</b></div>
            <div className="full"><span className="eyebrow">Behavioral driver</span><b style={{ fontWeight: 500 }}>{rv.driver}</b></div>
          </div>
          <div className="bubbles">
            {rv.reactions.map((r) => <div className="bub" key={r.text}>{r.text}<small>{r.respondent}</small></div>)}
          </div>
        </div>
        <button className="btn" disabled={s.busy} onClick={() => (rv.idx < 2 ? startRound(rv.idx + 1) : finish())}>
          {rv.idx < 2 ? 'Next round' : 'See my results'}
        </button>
      </>
    );
  }

  function Results() {
    const me = s.me;
    if (!me?.finished || !me.persona) return null;
    return (
      <>
        <div className="rl">
          <div className="score">
            <span className="eyebrow">Marketer Instinct Score</span>
            <span className="big">{fmt(me.score ?? 0)}</span>
            <div className="row"><span>You matched the simulated audience on {me.correct} of 3</span></div>
          </div>
          <div className="persona">
            <span className="eyebrow">Your persona</span>
            <h3>{me.persona}</h3>
            <span className="small">{PERSONAS[me.persona]}</span>
          </div>
        </div>
        <div className="rr">
          <table className="recap">
            <tbody>
              {me.rounds.map((r) => (
                <tr key={r.idx}>
                  <td>{audience?.rounds[r.idx].brand}</td>
                  <td>{r.pick ? `You: ${r.pick.toUpperCase()}` : 'No pick'} · Crowd: {r.winner.toUpperCase()}</td>
                  <td className={r.correct ? 'ok-t' : 'no-t'}>+{r.points + r.bonus}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="toggle" aria-pressed={me.wantsSim} disabled={s.busy} onClick={() => toggleSim()}>
            <span className="box">{me.wantsSim ? '✓' : ''}</span>
            <span>Run a real Predikta simulation on my next campaign</span>
          </button>
        </div>
        <button className="btn spark" onClick={() => go('claim')}>
          {me.gc?.status === 'awarded' ? 'Claim my GCash GC' : 'See GC status'}
        </button>
      </>
    );
  }

  function Claim() {
    const gc = s.me?.gc;
    if (!gc) return null;
    if (gc.status === 'waiting') {
      return (
        <>
          <div className="claim">
            <h2 style={{ fontSize: '24px' }}>This drop is fully claimed</h2>
            <p className="muted" style={{ margin: 0 }}>
              Your score is saved.{' '}
              {gc.nextDropAt
                ? `Next GC drop at ${manilaTime(gc.nextDropAt)}. Come back then and tap the button below.`
                : 'All GCs for the event have been given out. Thank you for playing!'}
            </p>
            {gc.nextDropAt && <button className="btn" disabled={s.busy} onClick={() => refreshMe(true)}>Check again</button>}
          </div>
          <div className="spacer" />
          {variant === 'tv' && <button className="btn soft" onClick={reset}>Next player</button>}
        </>
      );
    }
    return (
      <>
        <div className="claim">
          <span className="chip">Manual fulfillment · booth staff</span>
          <span className="eyebrow">Show this to booth staff</span>
          <h2 style={{ fontSize: '24px' }}>Your reward is reserved</h2>
          <Qr text={gc.code} label={`Claim QR code for ${gc.code}`} />
          <span className="code">{gc.code}</span>
          <span className="small muted">GCash number: {gc.mobileMasked}. Staff will arrange your reward.</span>
          {gc.claimed ? (
            <span className="status done"><i />Fulfillment recorded</span>
          ) : (
            <span className="status wait"><i />Waiting for staff</span>
          )}
        </div>
        <div className="spacer" />
        {variant === 'tv' && <button className="btn soft" onClick={reset}>Next player</button>}
      </>
    );
  }

  const SCREENS: Record<Screen, () => React.JSX.Element | null> = {
    landing: Landing, signup: Signup, howto: HowTo, audience: AudienceScreen,
    round: RoundScreen, reveal: RevealScreen, results: Results, claim: Claim,
  };
  const Body = SCREENS[s.screen];
  const modalRound = s.modal && round;

  return (
    <div className={`game ${variant === 'phone' ? 'phoneapp' : ''}`} role={variant === 'phone' ? 'main' : undefined}>
      <div className="pbar">
        <span className="who">
          <Brand />
          {variant === 'tv' && <span>· playing on the big screen</span>}
        </span>
        <Wallet value={s.wallet} />
      </div>
      {s.net && (
        <div className="netbar" role="status">
          <span>{s.net.msg}</span>
          {s.net.retry && (
            <button onClick={() => { const retry = s.net!.retry!; patch({ net: null }); retry(); }}>Retry</button>
          )}
        </div>
      )}
      <div className="screen" data-s={s.screen} ref={screenEl} inert={!!s.modal}>
        {Body()}
      </div>
      {modalRound && (
        <div className="modal" aria-modal="true" role="dialog" aria-label={`Ad ${s.modal!.toUpperCase()} enlarged`} onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <AdCard ad={modalRound[s.modal!]} brand={modalRound.brand} label={s.modal!.toUpperCase()} inert />
          <div className="desc"><span className="eyebrow">About this ad</span><br />{modalRound[s.modal!].visual}</div>
          <button autoFocus className="btn soft" onClick={closeModal}>Close</button>
        </div>
      )}
    </div>
  );
}
