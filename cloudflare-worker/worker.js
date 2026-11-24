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

// ----- Dados de um link (título, imagem, preço, duração, autores): GET /linkinfo?url=… com a senha do Pingado -----
const LI_BAD_HOST = /^(localhost|.*\.local|.*\.internal)$|^\d{1,3}(\.\d{1,3}){3}$|^\[|^0x/i;
const LI_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ccedil: 'ç', Ccedil: 'Ç', ordm: 'º', ordf: 'ª' };
'aeiou'.split('').forEach((v) => { [['acute', 'áéíóú'], ['grave', 'àèìòù'], ['circ', 'âêîôû'], ['uml', 'äëïöü']].forEach(([n, set]) => { const c = set['aeiou'.indexOf(v)]; LI_ENT[v + n] = c; LI_ENT[v.toUpperCase() + n] = c.toUpperCase(); }); });
LI_ENT.atilde = 'ã'; LI_ENT.otilde = 'õ'; LI_ENT.Atilde = 'Ã'; LI_ENT.Otilde = 'Õ'; LI_ENT.ntilde = 'ñ';
const liDec = (s) => String(s == null ? '' : s).replace(/&(#x?[0-9a-f]+|[a-z]+[0-9]*);/gi, (m, c) => {
  if (c[0] !== '#') return LI_ENT[c] !== undefined ? LI_ENT[c] : (LI_ENT[c.toLowerCase()] !== undefined ? LI_ENT[c.toLowerCase()] : m);
  const n = c[1] === 'x' || c[1] === 'X' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
}).replace(/\s+/g, ' ').trim();
function liMetas(html) {
  const m = {}, re = /<meta\b[^>]*>/gi; let x;
  while ((x = re.exec(html))) {
    const t = x[0], k = (t.match(/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1], v = (t.match(/content\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (k && v != null) (m[k.toLowerCase()] = m[k.toLowerCase()] || []).push(liDec(v));
  }
  return m;
}
function liLd(html) {
  const out = [], re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let x;
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { out.push(o); if (o['@graph']) walk(o['@graph']); } };
  while ((x = re.exec(html))) { try { walk(JSON.parse(x[1].trim())); } catch (e) { /* JSON-LD inválido: ignora */ } }
  return out;
}
const liType = (o) => [].concat(o['@type'] || []).join(',');
const liName = (a) => [].concat(a || []).map((p) => (typeof p === 'string' ? p : (p && p.name) || '')).filter(Boolean).join('; ');
const liMoney = (v) => { let s = String(v == null ? '' : v).replace(/[^\d.,]/g, ''); if (!s) return 0; if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };
const liMin = (d) => { const m = String(d || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i); return m ? Math.round(((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) / 60) : 0; };
async function liYoutube(id) {
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 13) gzip' },
      body: JSON.stringify({ videoId: id, context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 33, hl: 'pt', gl: 'BR' } } }),
    });
    if (!r.ok) return null;
    const d = (await r.json()).videoDetails || {};
    return { sec: Number(d.lengthSeconds) || 0, title: liDec(d.title), author: liDec(d.author) };
  } catch (e) { return null; }
}
async function linkinfo(request, env, u) {
  const origins = String(env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const okOrigin = !origins.length || origins.includes(origin);
  const cors = { 'Access-Control-Allow-Origin': okOrigin && origin ? origin : (origins[0] || 'null'), 'Access-Control-Allow-Headers': 'Content-Type, X-Pingado-Token', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Vary': 'Origin', 'Content-Type': 'application/json' };
  const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!env.PINGADO_TOKEN) return out({ error: 'O Worker ainda não tem o segredo PINGADO_TOKEN.' }, 503);
  if (!okOrigin) return out({ error: 'Origem não permitida.' }, 403);
  if (request.headers.get('X-Pingado-Token') !== env.PINGADO_TOKEN) return out({ error: 'Token do Pingado inválido.' }, 401);
  let t; try { t = new URL(u.searchParams.get('url') || ''); } catch (e) { return out({ error: 'Endereço inválido.' }, 400); }
  if (!/^https?:$/.test(t.protocol) || LI_BAD_HOST.test(t.hostname)) return out({ error: 'Endereço não permitido.' }, 400);
  try {
    const host = t.hostname.replace(/^www\./, '');
    const yid = (host === 'youtu.be' ? t.pathname.slice(1) : /(^|\.)youtube\.com$/.test(host) ? (t.searchParams.get('v') || (t.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/) || [])[1] || '') : '').slice(0, 11);
    const yt0 = /^[\w-]{11}$/.test(yid) ? await liYoutube(yid) : null; // duração, título e canal pelo player do YouTube
    let r = { url: t.href }, html = '';
    try {
      r = await fetch(t, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RotinaLink/1.0)', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7', 'Accept': 'text/html,application/xhtml+xml', 'Cookie': 'CONSENT=YES+1' }, redirect: 'follow' });
      html = (await r.text()).slice(0, 700000);
    } catch (e) { if (!yt0) throw e; }
    const mt = liMetas(html), g = (...ks) => { for (const k of ks) if (mt[k] && mt[k][0]) return mt[k][0]; return ''; };
    const ld = liLd(html), pick = (re) => ld.find((o) => re.test(liType(o)));
    const prod = pick(/Product|Book/i), vid = pick(/VideoObject|Movie|MusicRecording|MusicAlbum|PodcastEpisode|Episode|TVSeries/i), art = pick(/ScholarlyArticle|Article/i);
    const main = prod || vid || art || {};
    let off = [].concat((prod && prod.offers) || [])[0] || {};
    if (off.offers) off = [].concat(off.offers)[0] || off;
    const price = liMoney(g('product:price:amount', 'og:price:amount') || off.price || (off.priceSpecification && off.priceSpecification.price) || off.lowPrice);
    let img = g('og:image', 'twitter:image') || (typeof main.image === 'string' ? main.image : liName([].concat(main.image || []).map((i) => (i && i.url) || i)));
    try { if (img) img = new URL(img, r.url).href; } catch (e) { img = ''; }
    const yt = (html.match(/"lengthSeconds":"(\d+)"/) || [])[1];
    const secMin = (s) => (Number(s) > 0 ? Math.max(1, Math.round(Number(s) / 60)) : 0);
    const dur = secMin(yt0 && yt0.sec) || liMin(main.duration) || liMin(g('duration')) || secMin(g('video:duration', 'og:video:duration', 'music:duration')) || secMin(yt);
    const title = (yt0 && yt0.title) || g('og:title', 'twitter:title', 'citation_title') || liDec(main.name) || liDec((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
    const author = (yt0 && yt0.author) || g('music:musician', 'og:audio:artist', 'book:author', 'article:author', 'author') || liName(main.author) || liName(main.director) || liDec((html.match(/<link itemprop="name" content="([^"]*)"/i) || [])[1]);
    const pages = [g('citation_firstpage'), g('citation_lastpage')].filter(Boolean).join('-');
    return out({
      title: liDec(title).slice(0, 300), author: liDec(author).slice(0, 200), image: img, desc: g('og:description', 'description', 'twitter:description').slice(0, 600) || liDec(main.description).slice(0, 600),
      site: g('og:site_name') || t.hostname.replace(/^www\./, ''), type: g('og:type'), price: price, currency: g('product:price:currency', 'og:price:currency') || off.priceCurrency || '', durationMin: dur, url: r.url,
      citation: mt.citation_title ? { authors: mt.citation_author || [], journal: g('citation_journal_title'), year: (g('citation_publication_date', 'citation_date', 'citation_online_date').match(/\d{4}/) || [])[0] || '', volume: g('citation_volume'), issue: g('citation_issue'), pages: pages, doi: g('citation_doi') } : null,
    });
  } catch (e) { return out({ error: 'Não consegui ler a página: ' + (e && e.message || e) }, 502); }
}

// ----- Galeria e pastas: GET /gallery?url=… (pasta do Google Drive ou álbum do Google Fotos) com a senha do Pingado -----
const GL_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const glDec = (s) => String(s == null ? '' : s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, c) => {
  if (c[0] !== '#') return GL_ENT[c.toLowerCase()] !== undefined ? GL_ENT[c.toLowerCase()] : m;
  const n = c[1] === 'x' || c[1] === 'X' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
}).replace(/\s+/g, ' ').trim();
const glType = (name, icon, folder) => {
  if (folder) return 'folder';
  const t = (String(icon || '') + ' ' + String(name || '')).toLowerCase();
  if (/pdf/.test(t)) return 'pdf';
  if (/image|\.(jpe?g|png|gif|webp|heic|heif|bmp|avif)\b/.test(t)) return 'image';
  if (/video|\.(mp4|mov|m4v|webm|mkv|avi)\b/.test(t)) return 'video';
  if (/google-apps\.(document|spreadsheet|presentation)|\.(docx?|xlsx?|pptx?)\b/.test(t)) return 'doc';
  return 'file';
};
// pasta do Drive: a página "embeddedfolderview" lista os itens (nome, id, tipo) de uma pasta compartilhada
function gdParse(html) {
  html = String(html || '');
  const title = glDec((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/ - (Google Drive|Google Drive)$/i, '');
  const starts = [...html.matchAll(/id="entry-([\w-]{10,})"/g)].map((m) => ({ id: m[1], at: m.index }));
  const items = [], folders = [], seen = new Set();
  starts.forEach((s, i) => {
    if (seen.has(s.id)) return; seen.add(s.id);
    const blk = html.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : s.at + 4000);
    const href = glDec((blk.match(/href="([^"]*drive\.google\.com\/[^"]+)"/) || [])[1] || '');
    const name = glDec((blk.match(/flip-entry-title[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
    const icon = (blk.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
    const isF = /\/drive\/(?:u\/\d+\/)?folders\//.test(href) || /folder/i.test(icon);
    if (!name) return;
    if (isF) folders.push({ id: s.id, name: name, url: 'https://drive.google.com/drive/folders/' + s.id });
    else {
      const ty = glType(name, icon, false);
      items.push({ id: s.id, name: name, type: ty, thumb: 'https://drive.google.com/thumbnail?id=' + s.id + '&sz=w480', full: ty === 'image' ? 'https://drive.google.com/thumbnail?id=' + s.id + '&sz=w1600' : '', preview: 'https://drive.google.com/file/d/' + s.id + '/preview', url: 'https://drive.google.com/file/d/' + s.id + '/view' });
    }
  });
  if (!starts.length) { // plano B: procura só os links dos arquivos
    [...html.matchAll(/href="https:\/\/drive\.google\.com\/(file\/d|drive\/folders)\/([\w-]{10,})[^"]*"[^>]*>([\s\S]{0,400}?)<\/a>/g)].forEach((m) => {
      const id = m[2]; if (seen.has(id)) return; seen.add(id);
      const name = glDec(m[3].replace(/<[^>]+>/g, ' '));
      if (!name) return;
      if (m[1] === 'drive/folders') folders.push({ id: id, name: name, url: 'https://drive.google.com/drive/folders/' + id });
      else { const ty = glType(name, '', false); items.push({ id: id, name: name, type: ty, thumb: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w480', full: ty === 'image' ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1600' : '', preview: 'https://drive.google.com/file/d/' + id + '/preview', url: 'https://drive.google.com/file/d/' + id + '/view' }); }
    });
  }
  const nat = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' });
  items.sort(nat); folders.sort(nat);
  return { title: title, items: items, folders: folders };
}
// álbum do Google Fotos: o endereço de cada foto aparece no HTML da página compartilhada
function gpParse(html) {
  html = String(html || '');
  const meta = (k) => glDec((html.match(new RegExp('<meta[^>]+(?:property|name)="' + k + '"[^>]+content="([^"]*)"', 'i')) || html.match(new RegExp('<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="' + k + '"', 'i')) || [])[1] || '');
  const title = meta('og:title') || glDec((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/ - Google Fotos$| - Google Photos$/i, '');
  const seen = new Set(), items = [];
  [...html.matchAll(/https:\/\/lh3\.googleusercontent\.com\/(pw|lr\/photo|d)\/([\w-]{30,})/g)].forEach((m) => {
    const id = m[2]; if (seen.has(id)) return; seen.add(id);
    const base = 'https://lh3.googleusercontent.com/' + m[1] + '/' + id;
    items.push({ id: id, name: '', type: 'image', thumb: base + '=w480', full: base + '=w2048', preview: '', url: base + '=w2048' });
  });
  const cover = (meta('og:image') || '').replace(/=[wsh]\d.*$/, '');
  // a capa do álbum costuma repetir a primeira foto: tira a duplicata
  const ci = cover ? items.findIndex((x) => cover.indexOf(x.id) >= 0) : -1;
  return { title: title.replace(/^[^\wÀ-ɏ]+/, ''), items: items.slice(0, 300), folders: [], cover: ci >= 0 ? '' : cover, coverIdx: ci };
}
const GL_BAD_HOST = /^(localhost|.*\.local|.*\.internal)$|^\d{1,3}(\.\d{1,3}){3}$|^\[|^0x/i;
async function gallery(request, env, u) {
  const origins = String(env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const okOrigin = !origins.length || origins.includes(origin);
  const cors = { 'Access-Control-Allow-Origin': okOrigin && origin ? origin : (origins[0] || 'null'), 'Access-Control-Allow-Headers': 'Content-Type, X-Pingado-Token', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Vary': 'Origin', 'Content-Type': 'application/json' };
  const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!env.PINGADO_TOKEN) return out({ error: 'O Worker ainda não tem o segredo PINGADO_TOKEN.' }, 503);
  if (!okOrigin) return out({ error: 'Origem não permitida.' }, 403);
  if (request.headers.get('X-Pingado-Token') !== env.PINGADO_TOKEN) return out({ error: 'Token do Pingado inválido.' }, 401);
  let t; try { t = new URL(u.searchParams.get('url') || ''); } catch (e) { return out({ error: 'Endereço inválido.' }, 400); }
  const host = t.hostname.replace(/^www\./, '');
  if (!/^https?:$/.test(t.protocol) || GL_BAD_HOST.test(t.hostname)) return out({ error: 'Endereço não permitido.' }, 400);
  const hdr = { 'User-Agent': 'Mozilla/5.0 (compatible; RotinaGaleria/1.0)', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7', 'Accept': 'text/html', 'Cookie': 'CONSENT=YES+1' };
  try {
    if (host === 'drive.google.com') {
      const id = (t.pathname.match(/\/folders\/([\w-]{10,})/) || [])[1] || t.searchParams.get('id') || '';
      if (!/^[\w-]{10,}$/.test(id)) return out({ error: 'Este link não é de uma pasta do Drive.' }, 400);
      const r = await fetch('https://drive.google.com/embeddedfolderview?id=' + id, { headers: hdr, redirect: 'follow' });
      if (!r.ok) return out({ error: 'O Drive não abriu a pasta (erro ' + r.status + '). Ela precisa estar compartilhada com “qualquer pessoa com o link”.' }, 502);
      const g = gdParse((await r.text()).slice(0, 1500000));
      if (!g.items.length && !g.folders.length) return out({ error: 'Não encontrei arquivos nesta pasta. Confira se ela está compartilhada com “qualquer pessoa com o link”.' }, 404);
      return out({ kind: 'drive', id: id, url: 'https://drive.google.com/drive/folders/' + id, title: g.title, items: g.items.slice(0, 400), folders: g.folders.slice(0, 100) });
    }
    if (host === 'photos.app.goo.gl' || host === 'photos.google.com' || host === 'goo.gl') {
      const r = await fetch(t, { headers: hdr, redirect: 'follow' });
      const g = gpParse((await r.text()).slice(0, 2500000));
      if (!g.items.length) return out({ error: 'Não consegui ler as fotos deste álbum. Ele precisa estar compartilhado por link.' }, 404);
      return out({ kind: 'photos', url: r.url || t.href, title: g.title, items: g.items, folders: [], cover: g.cover });
    }
    return out({ error: 'Cole um link de pasta do Google Drive ou de álbum do Google Fotos.' }, 400);
  } catch (e) { return out({ error: 'Não consegui ler o link: ' + (e && e.message || e) }, 502); }
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
    // dados de um link (preço, duração, autores…) para preencher formulários do site
    if (u.pathname === '/linkinfo') return linkinfo(request, env, u);
    // fotos de um álbum do Google Fotos ou arquivos de uma pasta do Drive (galeria, livros)
    if (u.pathname === '/gallery') return gallery(request, env, u);
    // Pingado (assistente Gemini): a chave fica só aqui, nos segredos do Worker
    if (u.pathname.startsWith('/pingado/')) return pingado(request, env, u);
    return new Response(env.VAPID_PRIVATE ? 'Rotina de Estudos · avisos ativos (verifica a cada 5 minutos).' : 'Falta configurar o segredo VAPID_PRIVATE.', { headers: { 'content-type': 'text/plain; charset=utf-8' } }); },
};
