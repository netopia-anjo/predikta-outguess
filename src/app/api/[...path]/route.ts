import { NextRequest, NextResponse } from 'next/server';
import { GameService, HttpError } from '@/server/service';
import { config } from '@/server/config';
import { getPool } from '@/server/db';
import { exportCsv } from '@/server/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const COOKIE = 'outguess.staff';
const TV_COOKIE = 'outguess.tv';

async function handle(req: NextRequest) {
  try {
    const c = config();
    const service = new GameService(getPool(),c);
    let path = req.nextUrl.pathname;
    const method = req.method;
    if (method === 'POST') {
      const origin = req.headers.get('origin');
      if (origin && origin !== c.publicUrl) throw new HttpError(403,'invalid_origin');
      if (req.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403,'invalid_origin');
      if (!req.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415,'json_required');
      if (Number(req.headers.get('content-length') || 0) > 16_384) throw new HttpError(413,'payload_too_large');
    }
    const raw = method === 'POST' ? await req.text() : '';
    if (raw.length > 16_384) throw new HttpError(413,'payload_too_large');
    let body: Record<string,unknown> = {};
    try { if (raw) body = JSON.parse(raw); } catch { throw new HttpError(400,'invalid_json'); }
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new HttpError(400,'invalid_json');
    const player = req.headers.get('authorization')?.replace(/^Bearer /,'') ?? '';
    const staff = req.cookies.get(COOKIE)?.value ?? '';
    const tv = req.cookies.get(TV_COOKIE)?.value ?? '';
    if (path.startsWith('/api/tv/') && !['/api/tv/login','/api/tv/logout','/api/tv/session'].includes(path)) {
      // Every TV data/game request needs the booth session, even with a player token.
      await service.tv(tv);
      path = path.replace('/api/tv/','/api/');
      if (!['/api/content','/api/board','/api/players','/api/me'].includes(path) && !path.startsWith('/api/game/')) throw new HttpError(404,'not_found');
      if (path === '/api/players' && body.source !== 'tv') throw new HttpError(400,'invalid_source');
    } else if (path === '/api/players' && body.source === 'tv') throw new HttpError(401,'tv_required');
    let data: unknown;
    if (method === 'GET' && path === '/api/health') {
      await getPool().query('SELECT 1');
      await service.event();
      await service.inventory();
      data = { ok:true };
    } else if (method === 'GET' && path === '/api/content') data = await service.content();
    else if (method === 'GET' && path === '/api/board') data = await service.board();
    else if (method === 'POST' && path === '/api/players') data = await service.signup(body,req.headers.get('idempotency-key') || '');
    else if (method === 'GET' && path === '/api/me') data = await service.current(player);
    else if (method === 'POST' && path === '/api/game/audience') data = await service.audience(player,body.audienceId);
    else if (method === 'POST' && /^\/api\/game\/rounds\/\d+\/(start|lock)$/.test(path)) {
      const parts = path.split('/');
      data = parts[5] === 'start' ? await service.start(player,Number(parts[4])) : await service.lock(player,Number(parts[4]),body);
    } else if (method === 'POST' && path === '/api/game/finish') data = await service.finish(player);
    else if (method === 'POST' && path === '/api/game/claim/retry') data = await service.retryAward(player);
    else if (method === 'POST' && path === '/api/game/profile') data = await service.profile(player,body);
    else if (method === 'POST' && path === '/api/game/sim') data = await service.interest(player,body.wants);
    else if (method === 'POST' && ['/api/staff/login','/api/tv/login'].includes(path)) {
      const kind = path.startsWith('/api/tv/') ? 'tv' : 'staff';
      // Cloud Run appends the trusted client address to X-Forwarded-For; ignore attacker-prepended entries.
      const chain = req.headers.get('x-forwarded-for')?.split(',').map(s=>s.trim()).filter(Boolean) ?? [];
      const identity = chain.at(-1) || 'local';
      const token = await service.login(body.pin,identity,kind);
      const res = NextResponse.json({ok:true});
      res.cookies.set(kind === 'tv' ? TV_COOKIE : COOKIE,token,{path:`/api/${kind}`,httpOnly:true,sameSite:'strict',secure:c.publicUrl.startsWith('https:'),maxAge:12*3600});
      res.headers.set('cache-control','no-store');
      return res;
    } else if (method === 'POST' && ['/api/staff/logout','/api/tv/logout'].includes(path)) {
      const kind = path.startsWith('/api/tv/') ? 'tv' : 'staff';
      const token = kind === 'tv' ? tv : staff;
      // Clearing an expired or already-revoked session should still lock the screen.
      try { await service.logout(token,kind); }
      catch (e) { if (!(e instanceof HttpError && e.status === 401)) throw e; }
      const res = NextResponse.json({ok:true});
      res.cookies.set(kind === 'tv' ? TV_COOKIE : COOKIE,'',{path:`/api/${kind}`,maxAge:0});
      res.headers.set('cache-control','no-store');
      return res;
    } else if (method === 'GET' && ['/api/staff/session','/api/tv/session'].includes(path)) {
      const kind = path.startsWith('/api/tv/') ? 'tv' : 'staff';
      try { await service.accessSession(kind === 'tv' ? tv : staff,kind); data = {ok:true}; }
      catch (e) { if (e instanceof HttpError && e.status === 401) data = {ok:false}; else throw e; }
    } else if (method === 'GET' && path === '/api/staff/summary') data = await service.summary(staff);
    else if (method === 'GET' && path === '/api/staff/inventory') data = await service.staffInventory(staff);
    else if (method === 'POST' && path === '/api/staff/inventory/day') data = await service.switchPrizeDay(staff,body);
    else if (method === 'POST' && path === '/api/staff/inventory') data = await service.updateInventory(staff,body);
    else if (method === 'GET' && ['/api/staff/export.csv','/api/staff/claims.csv'].includes(path)) {
      const claims = path.endsWith('claims.csv');
      return new NextResponse(exportCsv(await service.exportRows(staff),claims),{headers:{'content-type':'text/csv; charset=utf-8','cache-control':'no-store','content-disposition':`attachment; filename="outguess-${claims?'claims':'signups'}.csv"`}});
    } else if (/^\/api\/staff\/claims\/[A-Za-z0-9]{6}(\/claim)?$/.test(path)) {
      const parts = path.split('/');
      if (method === 'GET' && parts.length === 5) data = await service.lookup(staff,parts[4]);
      else if (method === 'POST' && parts[5] === 'claim') data = await service.claim(staff,parts[4],body);
      else throw new HttpError(405,'method_not_allowed');
    } else throw new HttpError(404,'not_found');
    return NextResponse.json(data,{headers:{'cache-control':'no-store'}});
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({error:e.code,...e.details},{status:e.status,headers:{'cache-control':'no-store'}});
    // Do not log payloads, tokens, phone numbers or SQL parameters.
    console.error(JSON.stringify({event:'api_error',type:e instanceof Error?e.name:'unknown'}));
    return NextResponse.json({error:'service_unavailable'},{status:503,headers:{'cache-control':'no-store'}});
  }
}
export const GET = handle;
export const POST = handle;
