// Worker do Cloudflare: a cada 5 minutos envia os avisos vencidos para os aparelhos cadastrados,
// mesmo com o site e o aplicativo fechados. Sem dependências (fetch + WebCrypto).
const DEF = {
  FB_PROJECT: 'site-pessoal-b4b19',
  FB_API_KEY: 'AIzaSyBU4owCJwloUlcfTP-cOeHjEo5hyzMH2tU',
  FB_KEY: 'hRM2z3YEF6yPtTwKQyFMIAQs551d6Jwh',
  VAPID_PUBLIC: 'BJtVT5ExeKLoPBxb_mq8wY6YBCpLKJeyo1BlvviTAfXzmy1X2RwK-DBTtwgGYvmTzjK14vat8R0Z5KjIqSku-oI',
  VAPID_SUBJECT: 'mailto:luiswgustavo15@gmail.com',
};
const WINDOW_MS = 3 * 3600 * 1000; // avisos mais velhos que isso são descartados

const enc = new TextEncoder();
const b64u = (buf) => { const a = new Uint8Array(buf); let s = ''; for (const c of a) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };

async function vapidHeader(endpoint, cfg) {
  const pub = unb64u(cfg.VAPID_PUBLIC);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: cfg.VAPID_PRIVATE, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: cfg.VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + cfg.VAPID_PUBLIC;
}

export async function run(env = {}, now = Date.now()) {
  const cfg = Object.assign({}, DEF, Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === 'string' && v)));
  const log = [];
  if (!cfg.VAPID_PRIVATE) { log.push('VAPID_PRIVATE não configurada'); return log; }
  const base = 'https://firestore.googleapis.com/v1/projects/' + cfg.FB_PROJECT + '/databases/(default)/documents/rotina/';
  const docUrl = (name, extra = '') => base + cfg.FB_KEY + '_' + name + '?key=' + cfg.FB_API_KEY + extra;
  const getDoc = async (name) => { const r = await fetch(docUrl(name)); if (r.status === 404) return null; if (!r.ok) throw new Error('Firestore ' + r.status); return r.json(); };
  const str = (d, f) => (d && d.fields && d.fields[f] && d.fields[f].stringValue) || '';
  const patch = async (name, fields) => {
    const mask = Object.keys(fields).map((f) => '&updateMask.fieldPaths=' + f).join('');
    const r = await fetch(docUrl(name, mask), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: v }])) }) });
    if (!r.ok) throw new Error('Firestore PATCH ' + r.status);
  };
  const idx = await getDoc('pushidx');
  const ids = JSON.parse(str(idx, 'ids') || '[]');
  for (const id of ids) {
    try {
      const name = 'push_' + id, d = await getDoc(name);
      if (!d) continue;
      const c = JSON.parse(str(d, 'json') || '{}'), sent = JSON.parse(str(d, 'sent') || '{}');
      const pend = JSON.parse(str(d, 'pending') || '[]');
      Object.keys(sent).forEach((k) => { if (now - sent[k] > 4 * 864e5) delete sent[k]; });
      const due = (c.items || []).filter((it) => it.a <= now && now - it.a <= WINDOW_MS && !sent[it.k]);
      if (!due.length) continue;
      due.forEach((it) => { sent[it.k] = now; pend.push({ k: it.k, t: it.t, b: it.b, u: it.u || '' }); });
      await patch(name, { pending: JSON.stringify(pend.slice(-30)), sent: JSON.stringify(sent) });
      const r = await fetch(c.sub.endpoint, { method: 'POST', headers: { Authorization: await vapidHeader(c.sub.endpoint, cfg), TTL: '3600', Urgency: 'high', 'Content-Length': '0' } });
      log.push(id + ': ' + due.length + ' aviso(s), HTTP ' + r.status);
      if (r.status === 404 || r.status === 410) await patch(name, { json: JSON.stringify({ items: [], sub: c.sub }) });
    } catch (e) { log.push(id + ': ' + e.message); }
  }
  return log;
}


// ----- Pingado: ponte segura para o Gemini -----
// Segredos: GEMINI_API_KEY (chave do Google AI Studio), PINGADO_TOKEN (senha que o site envia), ALLOWED_ORIGINS (endereços do site, separados por vírgula)
const PG_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/;
const PG_MAX = 8 * 1024 * 1024;
async function pingado(request, env, u) {
  const origins = String(env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const okOrigin = !origins.length || origins.includes(origin);
  const cors = { 'Access-Control-Allow-Origin': okOrigin && origin ? origin : (origins[0] || 'null'), 'Access-Control-Allow-Headers': 'Content-Type, X-Pingado-Token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin', 'Content-Type': 'application/json' };
  const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!env.GEMINI_API_KEY || !env.PINGADO_TOKEN) return out({ error: 'O Worker ainda não tem os segredos GEMINI_API_KEY e PINGADO_TOKEN.' }, 503);
  if (!okOrigin) return out({ error: 'Origem não permitida.' }, 403);
  if (request.headers.get('X-Pingado-Token') !== env.PINGADO_TOKEN) return out({ error: 'Token do Pingado inválido.' }, 401);
  const base = 'https://generativelanguage.googleapis.com/v1beta/';
  const headers = { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' };
  try {
    if (u.pathname === '/pingado/models' && request.method === 'GET') {
      const r = await fetch(base + 'models?pageSize=200', { headers });
      const j = await r.json();
      if (!r.ok) return out({ error: (j.error && j.error.message) || 'Erro do Google (' + r.status + ')' }, r.status);
      const models = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName || '', desc: (m.description || '').slice(0, 140) }));
      return out({ models });
    }
    if (u.pathname === '/pingado/generate' && request.method === 'POST') {
      const model = u.searchParams.get('model') || '';
      if (!PG_MODEL.test(model)) return out({ error: 'Modelo inválido.' }, 400);
      const body = await request.text();
      if (body.length > PG_MAX) return out({ error: 'Pedido grande demais.' }, 413);
      const r = await fetch(base + 'models/' + encodeURIComponent(model) + ':generateContent', { method: 'POST', headers, body });
      const t = await r.text();
      return new Response(t, { status: r.status, headers: cors });
    }
    return out({ error: 'Rota desconhecida.' }, 404);
  } catch (e) { return out({ error: 'Falha ao falar com o Google: ' + (e && e.message || e) }, 502); }
}

// ----- Pluggy (agregador do Open Finance): lê o Nubank e devolve contas, cartão, faturas e dívidas -----
// O Nubank não tem API pública para pessoas físicas; o caminho é um agregador autorizado pelo Open Finance.
// Segredos: PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET (painel da Pluggy), PINGADO_TOKEN (a mesma senha do site) e ALLOWED_ORIGINS.
// O "itemId" é o código da sua conexão com o Nubank na Pluggy; ele não dá acesso sozinho (a chave fica só aqui).
const PL_API = 'https://api.pluggy.ai';
const plNum = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const plDay = (v) => String(v || '').slice(0, 10);
export function plNormalize(raw) { // formato estável para o site, mesmo que a Pluggy mude campos opcionais
  const accounts = (raw.accounts || []).map((a) => {
    const cd = a.creditData || {};
    return { id: a.id, type: a.type === 'CREDIT' ? 'credit' : 'bank', name: a.marketingName || a.name || 'Conta', balance: plNum(a.balance), limit: plNum(cd.creditLimit), available: plNum(cd.availableCreditLimit), closeDate: plDay(cd.balanceCloseDate), dueDate: plDay(cd.balanceDueDate), minPay: plNum(cd.minimumPayment) };
  });
  const txs = [];
  Object.keys(raw.txs || {}).forEach((acc) => (raw.txs[acc] || []).forEach((t) => {
    const m = t.creditCardMetadata || {};
    txs.push({ id: t.id, account: acc, date: plDay(t.date), desc: t.description || t.descriptionRaw || '', amount: Math.abs(plNum(t.amount)), kind: t.type === 'CREDIT' ? 'in' : 'out', cat: t.category || '', parcela: m.installmentNumber ? m.installmentNumber + '/' + (m.totalInstallments || '?') : '' });
  }));
  const bills = [];
  Object.keys(raw.bills || {}).forEach((acc) => (raw.bills[acc] || []).forEach((b) => bills.push({ id: b.id, account: acc, due: plDay(b.dueDate), total: plNum(b.totalAmount), min: plNum(b.minimumPaymentAmount) })));
  const loans = (raw.loans || []).map((l) => ({ id: l.id, name: l.productName || l.type || 'Empréstimo', total: plNum(l.contractedAmount || l.totalAmount), balance: plNum(l.outstandingBalance != null ? l.outstandingBalance : (l.balance != null ? l.balance : l.contractedAmount)), due: plDay(l.dueDate), installments: plNum(l.installments && l.installments.length) }));
  return { accounts, txs, bills, loans, at: Date.now() };
}
async function pluggy(request, env, u) {
  const origins = String(env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const okOrigin = !origins.length || origins.includes(origin);
  const cors = { 'Access-Control-Allow-Origin': okOrigin && origin ? origin : (origins[0] || 'null'), 'Access-Control-Allow-Headers': 'Content-Type, X-Pingado-Token', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin', 'Content-Type': 'application/json' };
  const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!env.PLUGGY_CLIENT_ID || !env.PLUGGY_CLIENT_SECRET || !env.PINGADO_TOKEN) return out({ error: 'O Worker ainda não tem os segredos PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PINGADO_TOKEN.' }, 503);
  if (!okOrigin) return out({ error: 'Origem não permitida.' }, 403);
  if (request.headers.get('X-Pingado-Token') !== env.PINGADO_TOKEN) return out({ error: 'Token inválido.' }, 401);
  // token para abrir o widget de conexão da Pluggy (o site usa o accessToken para autorizar o banco)
  if (u.pathname === '/pluggy/connect-token' && request.method === 'POST') {
    let cb = {}; try { cb = JSON.parse(await request.text() || '{}'); } catch (e) { cb = {}; }
    try {
      const a = await fetch(PL_API + '/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: env.PLUGGY_CLIENT_ID, clientSecret: env.PLUGGY_CLIENT_SECRET }) });
      const aj = await a.json();
      if (!a.ok || !aj.apiKey) return out({ error: 'A Pluggy recusou as credenciais (' + a.status + ').' }, 502);
      const r = await fetch(PL_API + '/connect_token', { method: 'POST', headers: { 'X-API-KEY': aj.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ options: { clientUserId: String(cb.clientUserId || 'dono').slice(0, 64) } }) });
      const j = await r.json();
      if (!r.ok || !j.accessToken) return out({ error: 'Não consegui gerar o token de conexão (' + r.status + ').' }, 502);
      return out({ accessToken: j.accessToken });
    } catch (e) { return out({ error: 'Falha ao falar com a Pluggy: ' + (e && e.message || e) }, 502); }
  }
  if (u.pathname !== '/pluggy/sync' || request.method !== 'POST') return out({ error: 'Rota desconhecida.' }, 404);
  let body = {}; try { body = JSON.parse(await request.text() || '{}'); } catch (e) { return out({ error: 'Pedido inválido.' }, 400); }
  const itemId = String(body.itemId || '');
  if (!/^[0-9a-fA-F-]{20,60}$/.test(itemId)) return out({ error: 'Item da Pluggy inválido.' }, 400);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || '')) ? body.from : new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  try {
    const a = await fetch(PL_API + '/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: env.PLUGGY_CLIENT_ID, clientSecret: env.PLUGGY_CLIENT_SECRET }) });
    const aj = await a.json();
    if (!a.ok || !aj.apiKey) return out({ error: 'A Pluggy recusou as credenciais (' + a.status + ').' }, 502);
    const H = { 'X-API-KEY': aj.apiKey, 'Content-Type': 'application/json' };
    const get = async (path) => { const r = await fetch(PL_API + path, { headers: H }); if (!r.ok) return null; return r.json(); };
    const acc = await get('/accounts?itemId=' + encodeURIComponent(itemId));
    if (!acc) return out({ error: 'Não achei essa conexão na Pluggy. Confira o item.' }, 404);
    const accounts = acc.results || [], txs = {}, bills = {};
    for (const ac of accounts) {
      const list = [];
      for (let page = 1; page <= 3; page++) {
        const t = await get('/transactions?accountId=' + encodeURIComponent(ac.id) + '&from=' + from + '&pageSize=500&page=' + page);
        if (!t) break; list.push(...(t.results || [])); if (page >= (t.totalPages || 1)) break;
      }
      txs[ac.id] = list;
      if (ac.type === 'CREDIT') { const b = await get('/bills?accountId=' + encodeURIComponent(ac.id)); bills[ac.id] = (b && b.results) || []; }
    }
    const lo = await get('/loans?itemId=' + encodeURIComponent(itemId));
    return out(plNormalize({ accounts, txs, bills, loans: (lo && lo.results) || [] }));
  } catch (e) { return out({ error: 'Falha ao falar com a Pluggy: ' + (e && e.message || e) }, 502); }
}

// ----- Calendário .ics (somente leitura): GET /calendar.ics?token=… -----
// O token é criado no site (Ajustes > App e Widgets) e fica em prefs.icsToken, no mesmo documento do Firestore.
// Eventos (S.acts, com repetição semanal a cada N semanas, a cada N dias e exceções por dia) e datas (S.dates) viram um
// arquivo iCalendar (RFC 5545) que o Google Agenda, o Outlook e o Apple Agenda assinam por URL.
const ICS_TZ = 'America/Sao_Paulo';
const icsEsc = (t) => String(t == null ? '' : t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFold(line) { // linhas de no máximo 75 octetos; as continuações começam com um espaço
  const e = new TextEncoder();
  if (e.encode(line).length <= 75) return line;
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = e.encode(ch).length;
    if (bytes + b > 75) { out.push(cur); cur = ' ' + ch; bytes = 1 + b; } else { cur += ch; bytes += b; }
  }
  out.push(cur); return out.join('\r\n');
}
const icsDay = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const icsDow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
const icsMonday = (iso) => icsDay(iso, -((icsDow(iso) + 6) % 7));
const icsDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);
const icsYmd = (iso) => iso.replace(/-/g, '');
const icsHm = (t) => String(t).replace(':', '') + '00';
const icsAddMin = (t, m) => { const x = Math.min(1439, Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + m); return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
const ICS_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function buildIcs(S, nowMs = Date.now()) {
  const L = [];
  const push = (l) => L.push(icsFold(l));
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Site do Luis//Rotina//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Rotina', 'X-WR-TIMEZONE:' + ICS_TZ,
    'BEGIN:VTIMEZONE', 'TZID:' + ICS_TZ, 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:-0300', 'TZOFFSETTO:-0300', 'TZNAME:-03', 'END:STANDARD', 'END:VTIMEZONE'].forEach(push);
  const local = (name, iso, t) => name + ';TZID=' + ICS_TZ + ':' + icsYmd(iso) + 'T' + icsHm(t);
  const vevent = (o) => {
    push('BEGIN:VEVENT'); push('UID:' + o.uid); push('DTSTAMP:' + stamp);
    if (o.recId) push(local('RECURRENCE-ID', o.recId.d, o.recId.t));
    if (o.allDay) { push('DTSTART;VALUE=DATE:' + icsYmd(o.d)); push('DTEND;VALUE=DATE:' + icsYmd(icsDay(o.d, 1))); }
    else { push(local('DTSTART', o.d, o.start)); push(local('DTEND', o.d, o.end)); }
    if (o.rrule) push('RRULE:' + o.rrule);
    (o.ex || []).forEach((x) => push(local('EXDATE', x.d, x.t)));
    push('SUMMARY:' + icsEsc(o.summary));
    if (o.place) push('LOCATION:' + icsEsc(o.place));
    if (o.desc) push('DESCRIPTION:' + icsEsc(o.desc));
    push('END:VEVENT');
  };
  const until = (iso) => 'UNTIL=' + icsYmd(icsDay(iso, 1)) + 'T025959Z'; // fim do dia local (-03:00) em UTC
  for (const a of S.acts || []) {
    const title = a.title || a.theme || a.tipoAtv || 'Atividade';
    const descOf = (teacher) => [a.tipoAtv && 'Tipo: ' + a.tipoAtv, teacher && 'Professor(es): ' + teacher, a.doWhat && 'Objetivos: ' + a.doWhat, a.obs && 'Observações: ' + a.obs, a.link && 'Link: ' + a.link].filter(Boolean).join('\n');
    const ov = a.overrides || {};
    for (const s of a.slots || []) {
      if (!s || !s.start) continue;
      const end = s.end && s.end > s.start ? s.end : icsAddMin(s.start, 60), uid = (a.id || 'a') + '-' + (s.id || 's') + '@rotina';
      if (s.mode === 'date') {
        if (!s.date) continue;
        vevent({ uid, d: s.date, start: s.start, end, summary: title, place: a.place, desc: descOf(a.teacher) });
        continue;
      }
      const every = Math.max(1, Number(s.every) || 1);
      let first, rule, valid;
      if (s.mode === 'days') {
        if (!s.date) continue;
        first = s.date; rule = 'FREQ=DAILY;INTERVAL=' + every;
        valid = (d) => d >= first && icsDiff(d, first) % every === 0;
      } else {
        const from = s.from || new Date(a.createdAt || nowMs).toISOString().slice(0, 10);
        first = from; for (let i = 0; i < 7 && icsDow(first) !== s.weekday; i++) first = icsDay(first, 1);
        rule = 'FREQ=WEEKLY;INTERVAL=' + every + ';BYDAY=' + ICS_BYDAY[s.weekday];
        valid = (d) => d >= first && icsDow(d) === s.weekday && Math.round(icsDiff(icsMonday(d), icsMonday(first)) / 7) % every === 0;
      }
      if (s.until) { if (s.until < first) continue; rule += ';' + until(s.until); }
      const dates = Object.keys(ov).filter((d) => valid(d) && (!s.until || d <= s.until)).sort();
      const ex = dates.filter((d) => ov[d] && ov[d].cancelled).map((d) => ({ d, t: s.start }));
      vevent({ uid, d: first, start: s.start, end, summary: title, place: a.place, desc: descOf(a.teacher), rrule: rule, ex });
      for (const d of dates) { // exceções: uma ocorrência alterada vira um evento filho com RECURRENCE-ID
        const o = ov[d]; if (!o || o.cancelled) continue;
        const st = o.start || s.start, en = o.end && o.end > st ? o.end : (o.start ? icsAddMin(st, 60) : end);
        vevent({ uid, recId: { d, t: s.start }, d, start: st, end: en, summary: o.title || title, place: o.place != null ? o.place : a.place, desc: descOf(o.teacher != null ? o.teacher : a.teacher) });
      }
    }
  }
  for (const x of S.dates || []) {
    if (!x || !x.date) continue;
    const summary = (x.cat ? x.cat + ': ' : '') + (x.title || 'Data'), uid = (x.id || x.date) + '@rotina';
    if (x.time && /^\d{2}:\d{2}$/.test(x.time)) vevent({ uid, d: x.date, start: x.time, end: icsAddMin(x.time, 60), summary, desc: x.notes });
    else vevent({ uid, d: x.date, allDay: true, summary, desc: x.notes });
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

const icsSafeEq = (a, b) => { a = String(a); b = String(b); let r = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return r === 0; };
// lê as partes do estado no Firestore (REST): meta -> p_<chave>_<n>
function icsReader(cfg) {
  const base = 'https://firestore.googleapis.com/v1/projects/' + cfg.FB_PROJECT + '/databases/(default)/documents/rotina/' + cfg.FB_KEY + '_';
  const get = async (name) => { const r = await fetch(base + name + '?key=' + cfg.FB_API_KEY); if (r.status === 404) return null; if (!r.ok) throw new Error('Firestore ' + r.status); return r.json(); };
  let meta;
  return async (key) => {
    if (!meta) meta = await get('meta');
    const p = meta && meta.fields && meta.fields.parts && meta.fields.parts.mapValue && meta.fields.parts.mapValue.fields && meta.fields.parts.mapValue.fields[key];
    if (!p) return null;
    const n = Number(p.mapValue.fields.n.integerValue || 0);
    const docs = await Promise.all(Array.from({ length: n }, (_, i) => get('p_' + key + '_' + i)));
    if (docs.some((d) => !d)) throw new Error('dados incompletos (' + key + ')');
    return JSON.parse(docs.map((d) => d.fields.t.stringValue).join(''));
  };
}
async function calendar(request, env, u) {
  const cfg = Object.assign({}, DEF, Object.fromEntries(Object.entries(env || {}).filter(([, v]) => typeof v === 'string' && v)));
  const txt = (body, status) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return txt('Método não permitido.', 405);
  const token = u.searchParams.get('token') || '';
  if (token.length < 16) return txt('Token ausente ou inválido.', 403);
  try {
    const part = icsReader(cfg);
    const misc = await part('misc'), want = (misc && misc.prefs && misc.prefs.icsToken) || '';
    if (!want || !icsSafeEq(token, want)) return txt('Token inválido.', 403); // só lê os eventos depois de conferir o token
    const body = buildIcs({ acts: (await part('acts')) || [], dates: (await part('dates')) || [] });
    return new Response(request.method === 'HEAD' ? null : body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="rotina.ics"', 'Cache-Control': 'private, max-age=300' } });
  } catch (e) { return txt('Não foi possível ler os dados: ' + e.message, 503); }
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env).then((l) => console.log(l.join('\n') || 'Nada a enviar.'))); },
  async fetch(request, env) {
    const u = new URL(request.url), cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    // calendário .ics somente leitura: /calendar.ics?token=… (o token é criado no site)
    if (u.pathname === '/calendar.ics') return calendar(request, env, u);
    // título de uma página pública (usado ao colar links em Documentos): ?u=<endereço>
    if (u.searchParams.get('u')) {
      try {
        const t = new URL(u.searchParams.get('u'));
        if (!/^https?:$/.test(t.protocol)) throw new Error('endereço inválido');
        const r = await fetch(t, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RotinaTitulo/1.0)' }, redirect: 'follow' });
        const html = (await r.text()).slice(0, 200000);
        const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        const title = m ? m[1].replace(/\s+/g, ' ').replace(/ - (Google (Docs|Sheets|Slides|Drive)|Planilhas Google|Apresentações Google|Documentos Google)$/i, '').trim() : '';
        return new Response(JSON.stringify({ title }), { headers: cors });
      } catch (e) { return new Response(JSON.stringify({ title: '' }), { headers: cors }); }
    }
    // Pingado (assistente Gemini): a chave fica só aqui, nos segredos do Worker
    if (u.pathname.startsWith('/pingado/')) return pingado(request, env, u);
    if (u.pathname.startsWith('/pluggy/')) return pluggy(request, env, u);
    return new Response(env.VAPID_PRIVATE ? 'Rotina de Estudos · avisos ativos (verifica a cada 5 minutos).' : 'Falta configurar o segredo VAPID_PRIVATE.', { headers: { 'content-type': 'text/plain; charset=utf-8' } }); },
};
