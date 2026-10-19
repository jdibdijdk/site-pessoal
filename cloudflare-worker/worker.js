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

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env).then((l) => console.log(l.join('\n') || 'Nada a enviar.'))); },
  async fetch(request, env) { return new Response(env.VAPID_PRIVATE ? 'Rotina de Estudos · avisos ativos (verifica a cada 5 minutos).' : 'Falta configurar o segredo VAPID_PRIVATE.', { headers: { 'content-type': 'text/plain; charset=utf-8' } }); },
};
