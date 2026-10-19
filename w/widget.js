// Widgets da Rotina: cada pasta (w/painel, w/tarefas…) é um mini-app instalável na tela inicial.
// Lê o resumo que o app grava neste aparelho (localStorage "rotina_widgets") e mostra uma informação por linha.
(function () {
  'use strict';
  const F = document.body.dataset.f || 'painel';
  const KEY = 'rotina_widgets', QKEY = 'rotina_wq';
  const APP = '../../';
  const ICO = {
    painel: '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/>',
    semana: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    tarefas: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
    habitos: '<path d="M7 20h10M12 20v-8M12 12C12 8 9 6 5 6c0 4 3 6 7 6zM12 10c0-3 2-5 6-5 0 3-2 5-6 5z"/>',
    notas: '<path d="M15 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M15 3v5h5M8 13h8M8 17h5"/>',
    fin: '<path d="M20 12V8a2 2 0 00-2-2H5a2 2 0 010-4h12"/><path d="M4 6v12a2 2 0 002 2h14v-4"/><path d="M18 12a2 2 0 000 4h4v-4z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>'
  };
  const TITLE = { painel: 'Hoje', semana: 'Semana', tarefas: 'Tarefas', habitos: 'Hábitos', notas: 'Notas', fin: 'Finanças' };
  const svg = (n, s) => '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICO[n] || '') + '</svg>';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addISO = (s, n) => { const p = s.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2] + n); return iso(d); };
  const WD = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const dm = (s) => { const p = s.split('-'); return p[2] + '/' + p[1]; };
  const dayLbl = (s, T) => s === T ? 'Hoje' : s === addISO(T, 1) ? 'Amanhã' : WD[new Date(s + 'T12:00').getDay()] + ', ' + dm(s);
  const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* armazenamento bloqueado */ } }
  function queue(x) { try { const q = JSON.parse(localStorage.getItem(QKEY) || '[]'); q.push(Object.assign({ at: Date.now() }, x)); localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) { /* sem fila */ } }

  const li = (t, m, extra, cls) => '<li' + (cls ? ' class="' + cls + '"' : '') + '>' + (extra || '') + '<span class="t">' + esc(t) + '</span>' + (m ? '<span class="m">' + esc(m) + '</span>' : '') + '</li>';
  const ck = (on, a, id, d) => '<button class="ck' + (on ? ' on' : '') + '" data-a="' + a + '" data-id="' + esc(id) + '"' + (d ? ' data-d="' + d + '"' : '') + ' aria-label="' + (on ? 'Desmarcar' : 'Marcar como feito') + '">' + svg('check', 15) + '</button>';
  const dot = (c) => '<i class="dot"' + (c ? ' style="background:' + esc(c) + '"' : '') + '></i>';

  function body(s, T) {
    let h = '', sub = '', bar = null;
    if (F === 'painel') {
      const today = s.ev.filter((x) => x.d === T), left = today.filter((x) => !x.ok && x.e >= nowHM());
      const hb = s.habits.filter((x) => x.d === T), hbDone = hb.filter((x) => x.ok).length;
      const tk = s.tasks.filter((x) => x.d && x.d <= T);
      const total = today.length + hb.length, done = today.filter((x) => x.ok).length + hbDone;
      bar = total ? done / total : null; sub = total ? done + '/' + total : '';
      h = left.slice(0, 3).map((x) => li(x.t, x.s + '–' + x.e, dot(x.c))).join('');
      if (tk.length) h += li(tk.length + (tk.length === 1 ? ' tarefa para hoje' : ' tarefas para hoje'), '', dot());
      if (hb.length) h += li('Hábitos: ' + hbDone + ' de ' + hb.length, '', dot());
      if (!h) h = '<div class="empty">Nada pendente hoje.</div>';
    } else if (F === 'semana') {
      const days = [T, addISO(T, 1)];
      days.forEach((d) => {
        const l = s.ev.filter((x) => x.d === d);
        h += '<li class="day">' + dayLbl(d, T) + '</li>' + (l.length ? l.slice(0, 6).map((x) => li(x.t, x.s + '–' + x.e, dot(x.c), x.ok ? 'done' : '')).join('') : li('Sem eventos', ''));
      });
    } else if (F === 'tarefas') {
      const l = s.tasks.slice(0, 7); sub = s.tasks.length ? String(s.tasks.length) : '';
      h = l.length ? l.map((x) => li(x.t, x.d ? (x.d < T ? 'Atrasada' : dayLbl(x.d, T)) + (x.h ? ' ' + x.h : '') : '', ck(x.ok, 'task', x.id), x.ok ? 'done' : '')).join('') : '<div class="empty">Nenhuma tarefa pendente.</div>';
    } else if (F === 'habitos') {
      const l = s.habits.filter((x) => x.d === T), n = l.filter((x) => x.ok).length;
      bar = l.length ? n / l.length : null; sub = l.length ? n + '/' + l.length : '';
      h = l.length ? l.map((x) => li(x.t, x.s || (x.m ? x.m + ' min' : ''), ck(x.ok, 'habit', x.id, x.d), x.ok ? 'done' : '')).join('') : '<div class="empty">Nenhum hábito para hoje.</div>';
    } else if (F === 'notas') {
      h = s.notes.length ? s.notes.slice(0, 6).map((x) => '<a class="row" href="' + APP + '?nota=' + encodeURIComponent(x.id) + '">' + li(x.t, x.u ? dm(iso(new Date(x.u))) : '', dot()) + '</a>').join('') : '<div class="empty">Nenhuma nota ainda.</div>';
    } else if (F === 'fin') {
      h = s.bills.length ? s.bills.slice(0, 6).map((x) => li(x.t, dayLbl(x.d, T) + ' · ' + x.v, dot())).join('') : '<div class="empty">Nenhuma conta nos próximos dias.</div>';
    }
    return { h: h, sub: sub, bar: bar };
  }

  function render() {
    const s = read(), T = iso(new Date()), root = document.getElementById('w');
    let inner;
    if (!s) inner = '<div class="empty">Abra o app neste aparelho para preparar o widget.</div>';
    else {
      ['ev', 'tasks', 'habits', 'notes', 'bills'].forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });
      const b = body(s, T);
      inner = (b.bar != null ? '<div class="bar"><i style="width:' + Math.round(b.bar * 100) + '%"></i></div>' : '') + '<ul>' + b.h + '</ul>';
      root.dataset.sub = b.sub;
    }
    const age = s && s.at ? Math.round((Date.now() - s.at) / 60000) : null;
    const upd = age == null ? '' : age < 1 ? 'Atualizado agora' : age < 60 ? 'Atualizado há ' + age + ' min' : age < 1440 ? 'Atualizado há ' + Math.round(age / 60) + ' h' : 'Abra o app para atualizar';
    root.innerHTML = '<div class="wh">' + svg(F, 22) + '<h1>' + TITLE[F] + '</h1><span class="sub">' + esc(root.dataset.sub || '') + '</span></div>' + inner +
      '<div class="ft"><small>' + upd + '</small><a href="' + APP + '?tab=' + F + '">Abrir</a></div>';
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button.ck');
    if (!b) return;
    const s = read(); if (!s) return;
    if (b.dataset.a === 'task') {
      const t = (s.tasks || []).find((x) => x.id === b.dataset.id); if (!t || t.ok) return;
      t.ok = 1; queue({ a: 'task', id: t.id });
    } else if (b.dataset.a === 'habit') {
      const h = (s.habits || []).find((x) => x.id === b.dataset.id && x.d === b.dataset.d); if (!h) return;
      h.ok = h.ok ? 0 : 1; queue({ a: 'habit', id: h.id, d: h.d, on: !!h.ok });
    }
    write(s); render();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
  window.addEventListener('storage', (e) => { if (e.key === KEY) render(); });
  setInterval(render, 60000);
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../../sw.js', { scope: '../../' }).catch(() => {});
})();
