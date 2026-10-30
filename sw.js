// Service worker da Rotina de Estudos: guarda o app para abrir sem internet, mostra os avisos enviados pelo
// servidor (Web Push), trata os botões das notificações e entrega os dados dos widgets.
const PROJECT = 'site-pessoal-b4b19';
const API_KEY = 'AIzaSyBU4owCJwloUlcfTP-cOeHjEo5hyzMH2tU';
const FB_KEY = 'hRM2z3YEF6yPtTwKQyFMIAQs551d6Jwh';
const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/rotina/';

const VERSION = 'v9';
const CACHE = 'rotina-app-' + VERSION;
const META = 'rotina-meta'; // dados dos widgets e avisos recebidos com o app fechado
const FRONTS = ['painel', 'semana', 'tarefas', 'habitos', 'notas', 'fin'];
const SHELL = ['./', 'index.html', 'slides.js', 'manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/badge-96.png',
  'w/widget.css', 'w/widget.js', 'w/card.json'].concat(FRONTS.map((f) => 'w/' + f + '/'));

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  // na primeira instalação assume na hora; nas seguintes espera o usuário tocar em "Atualizar"
  if (!self.registration.active) self.skipWaiting();
})()));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('rotina-app-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

/* ----- cache: páginas pela rede primeiro (sempre a versão nova), arquivos estáticos do cache ----- */
async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(req);
    if (r && r.ok) c.put(req, r.clone());
    return r;
  } catch (err) {
    return (await c.match(req, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error();
  }
}
async function cacheFirst(req) {
  const c = await caches.open(CACHE), hit = await c.match(req);
  if (hit) { fetch(req).then((r) => { if (r && r.ok) c.put(req, r); }).catch(() => {}); return hit; }
  const r = await fetch(req);
  if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
  return r;
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  // dados dos widgets do Windows: respondidos a partir do último resumo enviado pelo app
  const wd = u.origin === location.origin && u.pathname.match(/\/w\/data\/(\w+)\.json$/);
  if (wd) { e.respondWith(widgetData(wd[1]).then((d) => new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json' } }))); return; }
  if (u.origin === location.origin) {
    if (req.mode === 'navigate' || /\.(html|webmanifest)$/.test(u.pathname) || u.pathname.endsWith('/')) e.respondWith(networkFirst(req));
    else e.respondWith(cacheFirst(req));
    return;
  }
  // fontes do Google: guardadas para funcionar sem internet; Firestore, Apps Script e Drive nunca entram no cache
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com' || (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.indexOf('/jszip/') >= 0)) e.respondWith(cacheFirst(req));
});

/* ----- mensagens do app ----- */
self.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'skip') self.skipWaiting();
  if (m.type === 'widgets' && m.data) e.waitUntil(caches.open(META).then((c) => c.put('widgets.json', new Response(m.data, { headers: { 'content-type': 'application/json' } }))).then(updateWinWidgets));
});

/* ----- widgets do Windows 11 (Adaptive Cards) ----- */
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
async function widgetData(tag) {
  let s = {};
  try { const r = await (await caches.open(META)).match('widgets.json'); if (r) s = await r.json(); } catch (err) { /* sem resumo ainda */ }
  const T = iso(new Date()), rows = [];
  if (tag === 'tarefas') (s.tasks || []).slice(0, 5).forEach((t) => rows.push({ text: t.t, sub: t.d ? (t.d === T ? 'Hoje' : t.d.split('-').reverse().slice(0, 2).join('/')) : '' }));
  else if (tag === 'habitos') (s.habits || []).filter((h) => h.d === T).slice(0, 5).forEach((h) => rows.push({ text: (h.ok ? '✓ ' : '○ ') + h.t, sub: h.s || '' }));
  else (s.ev || []).filter((x) => x.d === T && !x.ok).slice(0, 5).forEach((x) => rows.push({ text: x.t, sub: x.s + '–' + x.e }));
  const title = { painel: 'Hoje', tarefas: 'Tarefas', habitos: 'Hábitos' }[tag] || 'Rotina';
  return { title: title, rows: rows.length ? rows : [{ text: 'Nada pendente', sub: '' }], url: './?tab=' + (tag === 'painel' ? 'painel' : tag) };
}
async function updateWinWidgets() {
  if (!self.widgets || !self.widgets.updateByTag) return;
  const tpl = await (await fetch('w/card.json')).text();
  for (const tag of ['painel', 'tarefas', 'habitos']) {
    try { await self.widgets.updateByTag(tag, { template: tpl, data: JSON.stringify(await widgetData(tag)) }); } catch (err) { /* widget não instalado */ }
  }
}
self.addEventListener('widgetinstall', (e) => e.waitUntil(updateWinWidgets()));
self.addEventListener('widgetresume', (e) => e.waitUntil(updateWinWidgets()));
self.addEventListener('widgetclick', (e) => { if (e.action === 'open') e.waitUntil(openOrFocus('./?tab=' + (e.widget && e.widget.definition ? e.widget.definition.tag : 'painel'))); });

/* ----- Web Push ----- */
async function sha(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
function actionsFor(k) {
  const p = String(k || '').split('|')[0];
  if (p === 'tk') return [{ action: 'done', title: 'Concluir' }, { action: 'snooze', title: 'Adiar 1h' }];
  if (p === 'hb') return [{ action: 'done', title: 'Feito' }, { action: 'snooze', title: 'Adiar 1h' }];
  if (p === 'ev' || p === 'pp') return [{ action: 'open', title: 'Abrir' }, { action: 'snooze', title: 'Adiar 10 min' }];
  return [];
}
// guarda os avisos que chegaram com o app fechado para a central de avisos mostrar depois
async function keepHistory(list) {
  try {
    const c = await caches.open(META), r = await c.match('nthist.json'), old = r ? await r.json() : [];
    await c.put('nthist.json', new Response(JSON.stringify(old.concat(list).slice(-50)), { headers: { 'content-type': 'application/json' } }));
  } catch (err) { /* sem cache */ }
}
async function broadcast(msg) { for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(msg); }

self.addEventListener('push', (e) => e.waitUntil((async () => {
  let shown = 0;
  const got = [];
  try {
    const sub = await self.registration.pushManager.getSubscription();
    const url = BASE + FB_KEY + '_push_' + (await sha(sub.endpoint)) + '?key=' + API_KEY;
    const d = await (await fetch(url)).json();
    const pend = JSON.parse((d.fields && d.fields.pending && d.fields.pending.stringValue) || '[]');
    for (const it of pend) {
      await self.registration.showNotification(it.t, { body: it.b, tag: it.k, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { u: it.u || './', k: it.k }, actions: actionsFor(it.k) });
      got.push({ k: it.k, t: it.t, b: it.b, u: it.u || '', at: Date.now() });
      shown++;
    }
    if (pend.length) {
      await fetch(url + '&updateMask.fieldPaths=pending', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { pending: { stringValue: '[]' } } }) });
    }
  } catch (err) { /* sem rede: cai no aviso genérico */ }
  if (!shown) {
    await self.registration.showNotification('Rotina de Estudos', { body: 'Você tem avisos pendentes.', tag: 'geral', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { u: './' } });
  }
  if (got.length) { await keepHistory(got); await broadcast({ type: 'pushed' }); }
  try { if (self.navigator.setAppBadge && got.length) await self.navigator.setAppBadge(got.length); } catch (err) { /* sem selo */ }
})()));

async function openOrFocus(u, msg) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of list) {
    if ('focus' in c) { await c.focus(); c.postMessage(msg || { type: 'open', u: u }); return; }
  }
  return self.clients.openWindow(u);
}
self.addEventListener('notificationclick', (e) => {
  const n = e.notification, d = n.data || {}, k = d.k || n.tag, u = d.u || './';
  n.close();
  if (e.action === 'done' || e.action === 'snooze') {
    const msg = { type: 'action', a: e.action, k: k, t: n.title, b: n.body };
    const q = './?do=' + e.action + '&k=' + encodeURIComponent(k) + '&t=' + encodeURIComponent(n.title || '') + '&b=' + encodeURIComponent(n.body || '');
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((l) => {
      if (l.length) { l.forEach((c) => c.postMessage(msg)); return; }
      return self.clients.openWindow(q);
    }));
    return;
  }
  e.waitUntil(openOrFocus(u));
});
