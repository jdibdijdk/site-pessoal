// Apresentador de slides da Rotina: lê um .pptx no próprio navegador (JSZip), desenha os slides em HTML,
// reproduz as transições e animações mais comuns e permite escrever por cima (caneta, caneta temporária, borracha).
(function () {
  'use strict';
  const EMU_PT = 12700; // 1 pt = 12700 EMU
  const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

  /* ---------- utilidades de XML ---------- */
  const kids = (el, name) => el ? Array.prototype.filter.call(el.children, (c) => c.localName === name) : [];
  const kid = (el, name) => kids(el, name)[0] || null;
  function path(el, names) { // path(el, 'cSld/spTree')
    let cur = el;
    for (const n of names.split('/')) { cur = kid(cur, n); if (!cur) return null; }
    return cur;
  }
  const attr = (el, a, d) => (el && el.hasAttribute(a) ? el.getAttribute(a) : d);
  const num = (el, a, d) => { const v = attr(el, a, null); return v == null ? d : Number(v); };
  const desc = (el, name) => (el ? Array.prototype.slice.call(el.getElementsByTagNameNS('*', name)) : []);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const xml = (txt) => new DOMParser().parseFromString(txt, 'application/xml').documentElement;
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
  function resolve(base, target) { // base 'ppt/slides/' + '../media/image1.png'
    if (target.charAt(0) === '/') return target.slice(1);
    const parts = (base + target).split('/'), out = [];
    parts.forEach((p) => { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return out.join('/');
  }

  /* ---------- cores ---------- */
  function hexToRgb(h) { const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    if (!s) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  const PRST = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080' };

  /* ---------- leitura do pacote ---------- */
  async function loadJSZip() {
    if (window.JSZip) return window.JSZip;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = JSZIP_URL; s.onload = res; s.onerror = () => rej(new Error('Não consegui carregar o leitor de .pptx (sem internet na primeira vez?).')); document.head.appendChild(s); });
    return window.JSZip;
  }

  async function parse(buf) {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(buf);
    const text = async (p) => { const f = zip.file(p); return f ? f.async('string') : null; };
    const relsCache = {};
    async function rels(part) {
      if (relsCache[part]) return relsCache[part];
      const p = dirOf(part) + '_rels/' + part.slice(part.lastIndexOf('/') + 1) + '.rels';
      const t = await text(p), map = {};
      if (t) kids(xml(t), 'Relationship').forEach((r) => { map[r.getAttribute('Id')] = { target: resolve(dirOf(part), r.getAttribute('Target')), type: r.getAttribute('Type') || '', ext: r.getAttribute('TargetMode') === 'External' }; });
      return (relsCache[part] = map);
    }
    const mediaUrls = {};
    async function media(p) {
      if (mediaUrls[p]) return mediaUrls[p];
      const f = zip.file(p); if (!f) return '';
      const ext = p.split('.').pop().toLowerCase();
      const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf' }[ext] || 'application/octet-stream';
      const blob = new Blob([await f.async('uint8array')], { type: type });
      return (mediaUrls[p] = URL.createObjectURL(blob));
    }

    const presPath = 'ppt/presentation.xml', pres = xml(await text(presPath)), presRels = await rels(presPath);
    const sz = path(pres, 'sldSz'), W = num(sz, 'cx', 12192000) / EMU_PT, H = num(sz, 'cy', 6858000) / EMU_PT;
    const slidePaths = kids(path(pres, 'sldIdLst'), 'sldId').map((s) => presRels[s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || attr(s, 'r:id')]).filter(Boolean).map((r) => r.target);

    const parts = {};
    async function part(p) {
      if (parts[p]) return parts[p];
      const t = await text(p); if (!t) return null;
      const doc = xml(t), r = await rels(p);
      return (parts[p] = { path: p, doc: doc, rels: r });
    }

    // tema (cores e fontes) do primeiro mestre
    async function themeOf(master) {
      const tr = Object.values(master.rels).find((r) => /\/theme$/.test(r.type));
      const th = tr ? await part(tr.target) : null, colors = {}, fonts = { major: 'Calibri Light', minor: 'Calibri' };
      if (th) {
        const cs = desc(th.doc, 'clrScheme')[0];
        if (cs) Array.prototype.forEach.call(cs.children, (c) => { const v = kid(c, 'srgbClr') ? attr(kid(c, 'srgbClr'), 'val') : kid(c, 'sysClr') ? attr(kid(c, 'sysClr'), 'lastClr', '000000') : '000000'; colors[c.localName] = v; });
        const fs = desc(th.doc, 'fontScheme')[0];
        if (fs) { const mj = path(fs, 'majorFont/latin'), mn = path(fs, 'minorFont/latin'); if (mj) fonts.major = attr(mj, 'typeface', fonts.major); if (mn) fonts.minor = attr(mn, 'typeface', fonts.minor); }
      }
      return { colors: colors, fonts: fonts };
    }

    const slides = [];
    for (let i = 0; i < slidePaths.length; i++) {
      const sl = await part(slidePaths[i]); if (!sl) continue;
      const lr = Object.values(sl.rels).find((r) => /\/slideLayout$/.test(r.type));
      const layout = lr ? await part(lr.target) : null;
      const mr = layout ? Object.values(layout.rels).find((r) => /\/slideMaster$/.test(r.type)) : null;
      const master = mr ? await part(mr.target) : null;
      const theme = master ? await themeOf(master) : { colors: {}, fonts: { major: 'Calibri Light', minor: 'Calibri' } };
      const ctx = new Ctx(sl, layout, master, theme, media, W, H);
      slides.push(await ctx.render());
    }
    return { W: W, H: H, slides: slides, dispose: () => Object.values(mediaUrls).forEach((u) => URL.revokeObjectURL(u)) };
  }

  /* ---------- desenho de um slide ---------- */
  function Ctx(slide, layout, master, theme, media, W, H) {
    this.slide = slide; this.layout = layout; this.master = master; this.theme = theme; this.media = media; this.W = W; this.H = H;
    const cm = master ? path(master.doc, 'clrMap') : null;
    this.clrMap = { bg1: attr(cm, 'bg1', 'lt1'), tx1: attr(cm, 'tx1', 'dk1'), bg2: attr(cm, 'bg2', 'lt2'), tx2: attr(cm, 'tx2', 'dk2') };
    this.anim = new Set();
  }
  Ctx.prototype.scheme = function (name) {
    const n = this.clrMap[name] || name;
    return this.theme.colors[n] || { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6' }[n] || '000000';
  };
  // cor com modificadores (lumMod, lumOff, tint, shade, alpha)
  Ctx.prototype.color = function (holder, phClr) {
    if (!holder) return null;
    let c = null, node = null;
    for (const n of ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr']) { node = kid(holder, n); if (node) break; }
    if (!node) return null;
    if (node.localName === 'srgbClr') c = attr(node, 'val');
    else if (node.localName === 'schemeClr') c = attr(node, 'val') === 'phClr' ? (phClr || '000000') : this.scheme(attr(node, 'val'));
    else if (node.localName === 'sysClr') c = attr(node, 'lastClr', '000000');
    else if (node.localName === 'prstClr') c = PRST[attr(node, 'val')] || '000000';
    else c = '000000';
    let [r, g, b] = hexToRgb(c), a = 1;
    const mods = Array.prototype.slice.call(node.children);
    if (mods.length) {
      let [h, s, l] = rgbToHsl(r, g, b);
      mods.forEach((m) => {
        const v = num(m, 'val', 100000) / 100000;
        if (m.localName === 'lumMod') l *= v; else if (m.localName === 'lumOff') l += v;
        else if (m.localName === 'tint') l = l + (1 - l) * (1 - v); else if (m.localName === 'shade') l *= v;
        else if (m.localName === 'satMod') s *= v; else if (m.localName === 'alpha') a = v;
      });
      [r, g, b] = hslToRgb(h, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, l)));
    }
    return a < 1 ? 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + a.toFixed(3) + ')' : 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  };
  Ctx.prototype.fill = async function (spPr, rels, base, styleFill) {
    if (!spPr) return styleFill || '';
    if (kid(spPr, 'noFill')) return 'transparent';
    const sf = kid(spPr, 'solidFill'); if (sf) return this.color(sf) || '';
    const gf = kid(spPr, 'gradFill');
    if (gf) {
      const stops = kids(kid(gf, 'gsLst'), 'gs').map((g) => this.color(g) + ' ' + (num(g, 'pos', 0) / 1000) + '%');
      const lin = kid(gf, 'lin'), ang = lin ? num(lin, 'ang', 0) / 60000 + 90 : 180;
      return stops.length ? 'linear-gradient(' + ang + 'deg,' + stops.join(',') + ')' : '';
    }
    const bf = kid(spPr, 'blipFill');
    if (bf) { const u = await this.blip(bf, rels); return u ? 'center/cover no-repeat url("' + u + '")' : ''; }
    return styleFill || '';
  };
  Ctx.prototype.blip = async function (blipFill, rels) {
    const b = kid(blipFill, 'blip'); if (!b) return '';
    const id = b.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || attr(b, 'r:embed');
    const r = id && rels[id]; return r && !r.ext ? this.media(r.target) : '';
  };

  Ctx.prototype.background = async function () {
    for (const p of [this.slide, this.layout, this.master]) {
      if (!p) continue;
      const bg = path(p.doc, 'cSld/bg'); if (!bg) continue;
      const bgPr = kid(bg, 'bgPr');
      if (bgPr) { const f = await this.fill(bgPr, p.rels); if (f) return f; }
      const ref = kid(bg, 'bgRef'); if (ref) { const c = this.color(ref); if (c) return c; }
    }
    return '#FFFFFF';
  };

  // placeholder correspondente no layout e no mestre (para herdar posição e estilos)
  function phOf(sp) { const ph = path(sp, 'nvSpPr/nvPr/ph') || path(sp, 'nvPicPr/nvPr/ph'); return ph ? { type: attr(ph, 'type', 'body'), idx: attr(ph, 'idx', null) } : null; }
  function findPh(partObj, ph) {
    if (!partObj || !ph) return null;
    const sps = kids(path(partObj.doc, 'cSld/spTree'), 'sp');
    let m = ph.idx != null ? sps.find((s) => { const p = phOf(s); return p && p.idx === ph.idx; }) : null;
    if (!m) m = sps.find((s) => { const p = phOf(s); const t = ph.type === 'ctrTitle' ? 'title' : ph.type; return p && (p.type === ph.type || p.type === t || (t === 'title' && p.type === 'ctrTitle')); });
    return m || null;
  }

  Ctx.prototype.render = async function () {
    const bg = await this.background();
    let html = '';
    const showMaster = (p) => !p || attr(p.doc, 'showMasterSp', '1') !== '0';
    if (this.master && showMaster(this.slide) && showMaster(this.layout)) html += await this.tree(path(this.master.doc, 'cSld/spTree'), this.master, true);
    if (this.layout && showMaster(this.slide)) html += await this.tree(path(this.layout.doc, 'cSld/spTree'), this.layout, true);
    html += await this.tree(path(this.slide.doc, 'cSld/spTree'), this.slide, false);
    const steps = this.timing();
    return { html: html, bg: bg, font: "'" + this.theme.fonts.minor + "',Carlito,Arial,sans-serif", steps: steps, transition: this.transition(), hidden: Array.from(this.anim) };
  };

  // percorre a árvore de formas; "deco" = só formas que não são placeholders (mestre e layout)
  Ctx.prototype.tree = async function (tree, p, deco, grp) {
    if (!tree) return '';
    let out = '';
    for (const el of Array.prototype.slice.call(tree.children)) {
      const n = el.localName;
      if (n === 'AlternateContent') { const fb = kid(el, 'Fallback') || kid(el, 'Choice'); if (fb) out += await this.tree(fb, p, deco, grp); continue; }
      if (deco && (n === 'sp' || n === 'pic') && phOf(el)) continue;
      if (n === 'sp' || n === 'cxnSp') out += await this.shape(el, p, grp);
      else if (n === 'pic') out += await this.pic(el, p, grp);
      else if (n === 'grpSp') out += await this.group(el, p, deco, grp);
      else if (n === 'graphicFrame') out += await this.frame(el, p, grp);
    }
    return out;
  };
  Ctx.prototype.xfrm = function (el, grp) {
    const x = path(el, 'spPr/xfrm') || path(el, 'grpSpPr/xfrm') || kid(el, 'xfrm');
    let box = null, rot = 0, flipH = false, flipV = false;
    if (x && kid(x, 'off')) {
      box = { x: num(kid(x, 'off'), 'x', 0), y: num(kid(x, 'off'), 'y', 0), w: num(kid(x, 'ext'), 'cx', 0), h: num(kid(x, 'ext'), 'cy', 0) };
      rot = num(x, 'rot', 0) / 60000; flipH = attr(x, 'flipH') === '1'; flipV = attr(x, 'flipV') === '1';
    } else {
      const ph = phOf(el);
      for (const src of [this.layout, this.master]) {
        const m = findPh(src, ph), mx = m ? path(m, 'spPr/xfrm') : null;
        if (mx && kid(mx, 'off')) { box = { x: num(kid(mx, 'off'), 'x', 0), y: num(kid(mx, 'off'), 'y', 0), w: num(kid(mx, 'ext'), 'cx', 0), h: num(kid(mx, 'ext'), 'cy', 0) }; break; }
      }
    }
    if (!box) return null;
    if (grp) { box = { x: grp.ox + (box.x - grp.cx) * grp.sx, y: grp.oy + (box.y - grp.cy) * grp.sy, w: box.w * grp.sx, h: box.h * grp.sy }; }
    return { x: box.x / EMU_PT, y: box.y / EMU_PT, w: box.w / EMU_PT, h: box.h / EMU_PT, rot: rot, flipH: flipH, flipV: flipV };
  };
  const pos = (b) => 'left:' + b.x.toFixed(2) + 'pt;top:' + b.y.toFixed(2) + 'pt;width:' + b.w.toFixed(2) + 'pt;height:' + b.h.toFixed(2) + 'pt;' +
    (b.rot || b.flipH || b.flipV ? 'transform:' + (b.rot ? 'rotate(' + b.rot + 'deg)' : '') + (b.flipH ? ' scaleX(-1)' : '') + (b.flipV ? ' scaleY(-1)' : '') + ';' : '');
  const idOf = (el) => { const c = path(el, 'nvSpPr/cNvPr') || path(el, 'nvPicPr/cNvPr') || path(el, 'nvGrpSpPr/cNvPr') || path(el, 'nvGraphicFramePr/cNvPr') || path(el, 'nvCxnSpPr/cNvPr'); return c ? attr(c, 'id', '') : ''; };

  Ctx.prototype.group = async function (el, p, deco, grp) {
    const x = path(el, 'grpSpPr/xfrm'); if (!x || !kid(x, 'off')) return this.tree(el, p, deco, grp);
    let ox = num(kid(x, 'off'), 'x', 0), oy = num(kid(x, 'off'), 'y', 0), ew = num(kid(x, 'ext'), 'cx', 1), eh = num(kid(x, 'ext'), 'cy', 1);
    const cx = num(kid(x, 'chOff'), 'x', ox), cy = num(kid(x, 'chOff'), 'y', oy), cw = num(kid(x, 'chExt'), 'cx', ew) || 1, ch = num(kid(x, 'chExt'), 'cy', eh) || 1;
    if (grp) { ox = grp.ox + (ox - grp.cx) * grp.sx; oy = grp.oy + (oy - grp.cy) * grp.sy; ew *= grp.sx; eh *= grp.sy; }
    const g = { ox: ox, oy: oy, cx: cx, cy: cy, sx: ew / cw, sy: eh / ch };
    const id = idOf(el), inner = await this.tree(el, p, deco, g);
    return '<div class="slg" data-sp="' + esc(id) + '">' + inner + '</div>';
  };

  Ctx.prototype.shape = async function (el, p, grp) {
    const b = this.xfrm(el, grp); if (!b) return '';
    const spPr = kid(el, 'spPr'), style = kid(el, 'style');
    const geom = spPr ? kid(spPr, 'prstGeom') : null, prst = geom ? attr(geom, 'prst', 'rect') : 'rect';
    const styleFill = style && kid(style, 'fillRef') && num(kid(style, 'fillRef'), 'idx', 0) > 0 ? this.color(kid(style, 'fillRef')) : '';
    let bg = await this.fill(spPr, p.rels, '', styleFill);
    let border = '';
    const ln = spPr ? kid(spPr, 'ln') : null;
    if (ln && !kid(ln, 'noFill')) {
      const lc = this.color(kid(ln, 'solidFill')) || (style && kid(style, 'lnRef') ? this.color(kid(style, 'lnRef')) : null);
      if (lc) border = 'border:' + Math.max(0.5, num(ln, 'w', 12700) / EMU_PT).toFixed(2) + 'pt solid ' + lc + ';';
    } else if (!ln && style && kid(style, 'lnRef') && num(kid(style, 'lnRef'), 'idx', 0) > 0 && el.localName !== 'cxnSp') {
      const lc = this.color(kid(style, 'lnRef')); if (lc) border = 'border:0.75pt solid ' + lc + ';';
    }
    if (el.localName === 'cxnSp') { // linha/conector: desenha só a linha
      const lc = (ln && this.color(kid(ln, 'solidFill'))) || (style && this.color(kid(style, 'lnRef'))) || '#000';
      const w = ln ? Math.max(0.75, num(ln, 'w', 12700) / EMU_PT) : 0.75;
      return '<svg class="sle" data-sp="' + esc(idOf(el)) + '" style="' + pos(b) + 'overflow:visible" viewBox="0 0 ' + Math.max(b.w, 0.01) + ' ' + Math.max(b.h, 0.01) + '" preserveAspectRatio="none"><line x1="0" y1="0" x2="' + b.w + '" y2="' + b.h + '" stroke="' + lc + '" stroke-width="' + w + '"/></svg>';
    }
    let radius = '';
    if (prst === 'ellipse') radius = 'border-radius:50%;';
    else if (/roundRect|round2SameRect|snipRoundRect/.test(prst)) { // ajuste "adj" = fração do lado menor (padrão 16,667%)
      const gd = geom ? desc(geom, 'gd')[0] : null, m = gd ? String(attr(gd, 'fmla', '')).match(/val\s+(\d+)/) : null;
      radius = 'border-radius:' + (Math.min(b.w, b.h) * (m ? Number(m[1]) : 16667) / 100000).toFixed(2) + 'pt;';
    }
    let clip = '';
    if (/triangle/.test(prst)) clip = 'clip-path:polygon(50% 0,100% 100%,0 100%);';
    else if (prst === 'rtTriangle') clip = 'clip-path:polygon(0 0,100% 100%,0 100%);';
    else if (prst === 'diamond') clip = 'clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);';
    else if (/rightArrow/.test(prst)) clip = 'clip-path:polygon(0 25%,65% 25%,65% 0,100% 50%,65% 100%,65% 75%,0 75%);';
    else if (/leftArrow/.test(prst)) clip = 'clip-path:polygon(100% 25%,35% 25%,35% 0,0 50%,35% 100%,35% 75%,100% 75%);';
    else if (prst === 'chevron') clip = 'clip-path:polygon(0 0,75% 0,100% 50%,75% 100%,0 100%,25% 50%);';
    else if (prst === 'pentagon' || prst === 'homePlate') clip = 'clip-path:polygon(0 0,80% 0,100% 50%,80% 100%,0 100%);';
    else if (prst === 'hexagon') clip = 'clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);';
    const fontRefClr = style && kid(style, 'fontRef') ? this.color(kid(style, 'fontRef')) : '';
    const txt = await this.text(el, p, fontRefClr);
    return '<div class="sle" data-sp="' + esc(idOf(el)) + '" style="' + pos(b) + (bg ? 'background:' + bg + ';' : '') + border + radius + clip + (fontRefClr ? 'color:' + fontRefClr + ';' : '') + '">' + txt + '</div>';
  };

  Ctx.prototype.pic = async function (el, p, grp) {
    const b = this.xfrm(el, grp); if (!b) return '';
    const bf = kid(el, 'blipFill'), u = bf ? await this.blip(bf, p.rels) : '';
    if (!u) return '';
    const sr = bf ? kid(bf, 'srcRect') : null;
    let img = '<img src="' + u + '" alt="" draggable="false" style="width:100%;height:100%;object-fit:fill">';
    if (sr) {
      const l = num(sr, 'l', 0) / 100000, t = num(sr, 't', 0) / 100000, r = num(sr, 'r', 0) / 100000, bt = num(sr, 'b', 0) / 100000;
      const w = 100 / Math.max(0.01, 1 - l - r), h = 100 / Math.max(0.01, 1 - t - bt);
      img = '<img src="' + u + '" alt="" draggable="false" style="position:absolute;width:' + w.toFixed(3) + '%;height:' + h.toFixed(3) + '%;left:' + (-l * w).toFixed(3) + '%;top:' + (-t * h).toFixed(3) + '%">';
    }
    const geom = path(el, 'spPr/prstGeom'), round = geom && attr(geom, 'prst') === 'ellipse' ? 'border-radius:50%;' : '';
    return '<div class="sle slpic" data-sp="' + esc(idOf(el)) + '" style="' + pos(b) + 'overflow:hidden;' + round + '">' + img + '</div>';
  };

  Ctx.prototype.frame = async function (el, p, grp) {
    const b = this.xfrm(el, grp); if (!b) return '';
    const tbl = desc(el, 'tbl')[0];
    if (tbl) {
      const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => num(c, 'w', 0) / EMU_PT);
      let rows = '';
      for (const tr of kids(tbl, 'tr')) {
        let cells = '';
        for (const tc of kids(tr, 'tc')) {
          if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') continue;
          const tcPr = kid(tc, 'tcPr'), bg = tcPr ? await this.fill(tcPr, p.rels) : '';
          const span = attr(tc, 'gridSpan', '1'), rspan = attr(tc, 'rowSpan', '1');
          const anchor = { t: 'top', ctr: 'middle', b: 'bottom' }[attr(tcPr, 'anchor', 't')] || 'top';
          cells += '<td' + (span !== '1' ? ' colspan="' + span + '"' : '') + (rspan !== '1' ? ' rowspan="' + rspan + '"' : '') + ' style="vertical-align:' + anchor + ';' + (bg ? 'background:' + bg + ';' : '') + '">' + (await this.paras(kid(tc, 'txBody'), null, [], 1)) + '</td>';
        }
        rows += '<tr style="height:' + (num(tr, 'h', 0) / EMU_PT).toFixed(2) + 'pt">' + cells + '</tr>';
      }
      return '<div class="sle" data-sp="' + esc(idOf(el)) + '" style="' + pos(b) + '"><table class="sltbl"><colgroup>' + cols.map((w) => '<col style="width:' + w.toFixed(2) + 'pt">').join('') + '</colgroup>' + rows + '</table></div>';
    }
    return '<div class="sle slph" data-sp="' + esc(idOf(el)) + '" style="' + pos(b) + '"><span>Gráfico ou diagrama</span></div>';
  };

  /* ---------- texto ---------- */
  // níveis de estilo (lvl1pPr…lvl9pPr) do mais específico ao mais geral
  Ctx.prototype.levels = function (el, lvl) {
    const out = [], ph = phOf(el), L = 'lvl' + (lvl + 1) + 'pPr';
    const push = (lst) => { const n = lst ? kid(lst, L) : null; if (n) out.push(n); };
    push(path(el, 'txBody/lstStyle'));
    if (ph) {
      push(path(findPh(this.layout, ph) || el, 'txBody/lstStyle'));
      push(path(findPh(this.master, ph) || el, 'txBody/lstStyle'));
      const ts = this.master ? path(this.master.doc, 'txStyles') : null;
      if (ts) push(kid(ts, ph.type === 'title' || ph.type === 'ctrTitle' ? 'titleStyle' : ph.type === 'body' || ph.type === 'subTitle' || ph.type === 'obj' ? 'bodyStyle' : 'otherStyle'));
    } else if (this.master) push(path(this.master.doc, 'txStyles/otherStyle'));
    return out;
  };
  Ctx.prototype.text = async function (el, p, refClr) {
    const tb = kid(el, 'txBody'); if (!tb) return '';
    const bp = kid(tb, 'bodyPr'), ph = phOf(el);
    let bpChain = [bp];
    if (ph) [this.layout, this.master].forEach((s) => { const m = findPh(s, ph); if (m) bpChain.push(path(m, 'txBody/bodyPr')); });
    bpChain = bpChain.filter(Boolean);
    const ba = (a, d) => { for (const n of bpChain) if (n.hasAttribute(a)) return n.getAttribute(a); return d; };
    const anchor = { t: 'flex-start', ctr: 'center', b: 'flex-end' }[ba('anchor', ph && (ph.type === 'ctrTitle' || ph.type === 'title') ? 'ctr' : 't')] || 'flex-start';
    const ins = (a, d) => (Number(ba(a, d)) / EMU_PT).toFixed(2) + 'pt';
    const af = bp ? kid(bp, 'normAutofit') : null, scale = af ? num(af, 'fontScale', 100000) / 100000 : 1, lnRed = af ? num(af, 'lnSpcReduction', 0) / 100000 : 0;
    const vert = ba('vert', 'horz'), wrap = ba('wrap', 'square') !== 'none';
    const inner = await this.paras(tb, el, null, scale, lnRed, refClr);
    if (!inner) return '';
    return '<div class="sltx" style="justify-content:' + anchor + ';padding:' + ins('tIns', 45720) + ' ' + ins('rIns', 91440) + ' ' + ins('bIns', 45720) + ' ' + ins('lIns', 91440) + ';' +
      (vert === 'vert' || vert === 'eaVert' ? 'writing-mode:vertical-rl;' : vert === 'vert270' ? 'writing-mode:vertical-rl;transform:rotate(180deg);' : '') + (wrap ? '' : 'white-space:nowrap;') + '">' + inner + '</div>';
  };
  Ctx.prototype.paras = async function (tb, el, fixedLevels, scale, lnRed, refClr) {
    if (!tb) return '';
    scale = scale || 1;
    const ps = kids(tb, 'p'); let html = '', any = false;
    const counters = {};
    for (const pEl of ps) {
      const pPr = kid(pEl, 'pPr'), lvl = num(pPr, 'lvl', 0);
      const chain = [pPr].concat(fixedLevels || (el ? this.levels(el, lvl) : [])).filter(Boolean);
      const pa = (a, d) => { for (const n of chain) if (n.hasAttribute(a)) return n.getAttribute(a); return d; };
      const pk = (name) => { for (const n of chain) { const k = kid(n, name); if (k) return k; } return null; };
      const defR = chain.map((n) => kid(n, 'defRPr')).filter(Boolean);
      const algn = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[pa('algn', 'l')] || 'left';
      const marL = Number(pa('marL', 0)) / EMU_PT, indent = Number(pa('indent', 0)) / EMU_PT;
      const lnS = pk('lnSpc'), spB = pk('spcBef'), spA = pk('spcAft');
      const pct = lnS && kid(lnS, 'spcPct') ? num(kid(lnS, 'spcPct'), 'val', 100000) / 100000 : 1;
      const lh = Math.max(0.6, pct * 1.2 * (1 - lnRed));
      const sp = (n) => (n && kid(n, 'spcPts') ? num(kid(n, 'spcPts'), 'val', 0) / 100 : 0);
      // tamanho e cor de base do parágrafo
      const baseR = (a, d) => { for (const n of defR) if (n.hasAttribute(a)) return n.getAttribute(a); return d; };
      const baseSz = Number(baseR('sz', 1800)) / 100;
      let runs = '', firstSz = null, firstClr = null;
      for (const r of Array.prototype.slice.call(pEl.children)) {
        if (r.localName === 'br') { runs += '<br>'; continue; }
        if (r.localName !== 'r' && r.localName !== 'fld') continue;
        const t = kid(r, 't'); const s = t ? t.textContent : '';
        if (!s) continue;
        any = true;
        const rPr = kid(r, 'rPr'), rc = [rPr].concat(defR).filter(Boolean);
        const ra = (a, d) => { for (const n of rc) if (n.hasAttribute(a)) return n.getAttribute(a); return d; };
        const rk = (name) => { for (const n of rc) { const k = kid(n, name); if (k) return k; } return null; };
        const sz = Number(ra('sz', baseSz * 100)) / 100 * scale;
        const own = rPr && kid(rPr, 'solidFill'), phStyled = el && phOf(el);
        const clr = own ? this.color(own) : (refClr && !phStyled) ? refClr : rk('solidFill') ? this.color(rk('solidFill')) : (refClr || null);
        const latin = rk('latin'); let font = latin ? attr(latin, 'typeface', '') : '';
        if (font === '+mj-lt') font = this.theme.fonts.major; else if (font === '+mn-lt' || !font) font = font ? this.theme.fonts.minor : '';
        if (firstSz == null) { firstSz = sz; firstClr = clr; }
        const st = 'font-size:' + sz.toFixed(2) + 'pt;' + (ra('b', '0') === '1' ? 'font-weight:700;' : '') + (ra('i', '0') === '1' ? 'font-style:italic;' : '') +
          (ra('u', 'none') !== 'none' ? 'text-decoration:underline;' : '') + (ra('strike', 'noStrike') !== 'noStrike' ? 'text-decoration:line-through;' : '') +
          (clr ? 'color:' + clr + ';' : '') + (font ? "font-family:'" + esc(font) + "',Carlito,Arial,sans-serif;" : '') + (ra('baseline', '0') !== '0' ? 'vertical-align:' + (Number(ra('baseline')) > 0 ? 'super' : 'sub') + ';font-size:' + (sz * 0.65).toFixed(2) + 'pt;' : '');
        runs += '<span style="' + st + '">' + esc(s) + '</span>';
      }
      // marcador
      let bullet = '';
      if (runs && !pk('buNone')) {
        const bc = pk('buChar'), an = pk('buAutoNum');
        const bclr = pk('buClr') ? this.color(pk('buClr')) : firstClr;
        if (bc) bullet = esc(attr(bc, 'char', '•'));
        else if (an) { const k = lvl; counters[k] = (counters[k] || num(an, 'startAt', 1) - 1) + 1; const tp = attr(an, 'type', 'arabicPeriod'); bullet = (/alphaLc/.test(tp) ? String.fromCharCode(96 + counters[k]) : /alphaUc/.test(tp) ? String.fromCharCode(64 + counters[k]) : counters[k]) + (/Paren/.test(tp) ? ')' : '.'); }
        if (bullet) bullet = '<span class="slbu" style="' + (bclr ? 'color:' + bclr + ';' : '') + 'width:' + Math.max(0, -indent).toFixed(2) + 'pt;margin-left:' + indent.toFixed(2) + 'pt">' + bullet + '</span>';
      }
      if (!runs) {
        const esz = (num(kid(pEl, 'endParaRPr'), 'sz', baseSz * 100) / 100) * scale;
        html += '<p style="font-size:' + esz.toFixed(2) + 'pt;line-height:' + lh + ';margin:' + sp(spB) + 'pt 0 ' + sp(spA) + 'pt;min-height:1em">&nbsp;</p>';
        continue;
      }
      html += '<p style="text-align:' + algn + ';margin:' + sp(spB).toFixed(1) + 'pt 0 ' + sp(spA).toFixed(1) + 'pt ' + marL.toFixed(2) + 'pt;line-height:' + lh.toFixed(2) + ';font-size:' + ((firstSz || baseSz)).toFixed(2) + 'pt">' + bullet + runs + '</p>';
    }
    return any ? html : '';
  };

  /* ---------- animações (p:timing) ---------- */
  Ctx.prototype.timing = function () {
    const t = path(this.slide.doc, 'timing'); if (!t) return [];
    const seq = desc(t, 'cTn').find((c) => attr(c, 'nodeType') === 'mainSeq');
    if (!seq) return [];
    const groups = kids(kid(seq, 'childTnLst'), 'par');
    const steps = [];
    groups.forEach((g, gi) => {
      const effects = [];
      let auto = false;
      desc(g, 'cTn').forEach((c) => {
        const cls = attr(c, 'presetClass', null); if (!cls || !attr(c, 'nodeType')) return;
        const nt = attr(c, 'nodeType');
        if (gi === 0 && nt === 'afterEffect' && !effects.length) auto = true;
        const tgt = desc(c, 'spTgt')[0]; if (!tgt) return;
        const spid = attr(tgt, 'spid', '');
        let dur = 0;
        desc(c, 'cTn').forEach((x) => { const d = attr(x, 'dur', null); if (d && d !== 'indefinite') dur = Math.max(dur, Number(d)); });
        // atraso: soma dos "delay" dos pais dentro do grupo
        let delay = 0;
        for (let n = c; n && n !== g; n = n.parentElement) if (n.localName === 'cTn') { const d = attr(n, 'delay', '0'); if (d !== 'indefinite') delay += Number(d) || 0; }
        effects.push({ spid: spid, cls: cls, preset: Number(attr(c, 'presetID', '10')), sub: Number(attr(c, 'presetSubtype', '0')), dur: cls === 'entr' && attr(c, 'presetID') === '1' ? 0 : (dur || 500), delay: delay, after: nt === 'afterEffect' });
        if (cls === 'entr') this.anim.add(spid);
      });
      if (effects.length) steps.push({ auto: auto, effects: effects });
    });
    // primeira aparição define quem começa oculto: se a primeira animação da forma for de saída, ela começa visível
    const first = {};
    steps.forEach((s) => s.effects.forEach((e) => { if (!(e.spid in first)) first[e.spid] = e.cls; }));
    Object.keys(first).forEach((k) => { if (first[k] !== 'entr') this.anim.delete(k); });
    return steps;
  };

  /* ---------- transição ---------- */
  Ctx.prototype.transition = function () {
    // prefere a versão "Choice" (mais rica) quando existir; senão a comum
    const all = desc(this.slide.doc, 'transition');
    const tr = all.find((x) => x.parentElement && x.parentElement.localName === 'Choice') || all[0] || null;
    if (!tr) return null;
    const effect = Array.prototype.slice.call(tr.children).find((c) => c.localName !== 'sndAc' && c.localName !== 'extLst');
    let dur = num(tr, 'p14:dur', null);
    if (dur == null) { const d = tr.getAttribute('dur') || tr.getAttributeNS('http://schemas.microsoft.com/office/powerpoint/2010/main', 'dur'); dur = d ? Number(d) : ({ slow: 1000, med: 750, fast: 500 }[attr(tr, 'spd', 'fast')] || 500); }
    const adv = tr.hasAttribute('advTm') ? Number(tr.getAttribute('advTm')) : null;
    return { type: effect ? effect.localName : 'fade', dir: effect ? attr(effect, 'dir', null) : null, orient: effect ? attr(effect, 'orient', null) : null, dur: dur, advTm: adv, advClick: attr(tr, 'advClick', '1') !== '0' };
  };

  /* ==================== apresentação ==================== */
  const COLORS = ['#E53935', '#FDD835', '#43A047', '#1E88E5', '#FFFFFF', '#111111'];
  const WIDTHS = [0.003, 0.006, 0.012];
  const ICON = {
    prev: '<path d="M15 18l-6-6 6-6"/>', next: '<path d="M9 18l6-6-6-6"/>', nav: '<path d="M3 3l7 17 2.5-7.5L20 10z"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>', temp: '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4"/><circle cx="12" cy="12" r="3"/>',
    erase: '<path d="M7 21h10M5.5 13.5l7-7a2 2 0 013 0l3 3a2 2 0 010 3l-7 7a2 2 0 01-3 0l-3-3a2 2 0 010-3z"/>', clear: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    full: '<path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>', black: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>'
  };
  const ico = (n) => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON[n] + '</svg>';

  // efeitos de entrada/saída em CSS (keyframes em slides.css embutido abaixo)
  function effectAnim(e) {
    const p = e.preset, d = e.sub;
    const dir = { 1: 'T', 2: 'R', 4: 'B', 8: 'L' }[d] || 'B';
    let name;
    if (e.cls === 'emph') name = 'slPulse';
    else if (p === 1) name = 'slAppear';
    else if (p === 2 || p === 12 || p === 42 || p === 47) name = 'slFly' + (p === 42 ? 'B' : p === 47 ? 'T' : dir);
    else if (p === 22) name = 'slWipe' + ({ 1: 'T', 2: 'R', 4: 'B', 8: 'L' }[d] || 'L');
    else if (p === 23 || p === 53 || p === 31 || p === 21) name = 'slZoom';
    else if (p === 16) name = 'slSplit';
    else name = 'slFade';
    return name + (e.cls === 'exit' ? 'Out' : '');
  }

  function present(deck, opts) {
    opts = opts || {};
    const annots = opts.annots || {}; // {indice: [traços]}
    const root = document.createElement('div');
    root.className = 'slp';
    root.innerHTML = '<div class="slstage-wrap"><div class="slstage"></div><canvas class="slink"></canvas><div class="slblack" hidden></div></div>' +
      '<div class="slbar">' +
      '<button data-x="prev" title="Anterior (←)">' + ico('prev') + '</button><span class="slnum"></span><button data-x="next" title="Próximo (→ ou espaço)">' + ico('next') + '</button><i class="slsep"></i>' +
      '<button data-x="tool" data-t="nav" title="Passar slides (clique avança)">' + ico('nav') + '</button>' +
      '<button data-x="tool" data-t="pen" title="Caneta (P)">' + ico('pen') + '</button>' +
      '<button data-x="tool" data-t="temp" title="Caneta temporária: some em segundos (T)">' + ico('temp') + '</button>' +
      '<button data-x="tool" data-t="erase" title="Borracha (E)">' + ico('erase') + '</button>' +
      '<span class="slcols">' + COLORS.map((c, i) => '<button data-x="color" data-i="' + i + '" style="--sc:' + c + '" aria-label="Cor"></button>').join('') + '</span>' +
      '<span class="slws">' + WIDTHS.map((w, i) => '<button data-x="width" data-i="' + i + '" aria-label="Espessura"><i style="width:' + (4 + i * 4) + 'px;height:' + (4 + i * 4) + 'px"></i></button>').join('') + '</span>' +
      '<button data-x="clear" title="Apagar os desenhos deste slide">' + ico('clear') + '</button><i class="slsep"></i>' +
      '<button data-x="black" title="Tela escura (B)">' + ico('black') + '</button>' +
      '<button data-x="full" title="Tela cheia (F)">' + ico('full') + '</button>' +
      '<button data-x="close" title="Sair (Esc)">' + ico('close') + '</button></div>';
    document.body.appendChild(root);
    const wrap = root.querySelector('.slstage-wrap'), stage = root.querySelector('.slstage'), cv = root.querySelector('.slink'), cx = cv.getContext('2d');
    const bar = root.querySelector('.slbar'), numEl = root.querySelector('.slnum'), black = root.querySelector('.slblack');
    stage.style.width = deck.W + 'pt'; stage.style.height = deck.H + 'pt';
    let idx = Math.max(0, Math.min(deck.slides.length - 1, opts.start || 0)), step = 0, tool = 'nav', color = 0, width = 1, cur = null, busy = false, advTimer = 0;
    const temps = []; // traços temporários {pts,c,w,t}

    function fit() {
      const r = root.getBoundingClientRect(), k = Math.min(r.width / (deck.W * 4 / 3), (r.height - 0) / (deck.H * 4 / 3));
      const w = deck.W * 4 / 3 * k, h = deck.H * 4 / 3 * k;
      wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
      stage.style.transform = 'scale(' + k + ')';
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
      draw();
    }
    function slideEl(i, final) {
      const s = deck.slides[i], d = document.createElement('div');
      d.className = 'sl'; d.style.background = s.bg; d.style.fontFamily = s.font; d.innerHTML = s.html;
      if (!final) s.hidden.forEach((id) => { d.querySelectorAll('[data-sp="' + CSS.escape(id) + '"]').forEach((n) => n.classList.add('slhid')); });
      return d;
    }
    function applySteps(el, i, upto) { // estado final de N passos, sem animação
      const s = deck.slides[i];
      for (let k = 0; k < upto && k < s.steps.length; k++) s.steps[k].effects.forEach((e) => {
        el.querySelectorAll('[data-sp="' + CSS.escape(e.spid) + '"]').forEach((n) => { if (e.cls === 'entr') n.classList.remove('slhid'); else if (e.cls === 'exit') n.classList.add('slhid'); });
      });
    }
    function playStep(el, st) {
      let t = 0;
      st.effects.forEach((e) => {
        const start = e.after ? t + e.delay : e.delay;
        el.querySelectorAll('[data-sp="' + CSS.escape(e.spid) + '"]').forEach((n) => {
          n.style.animation = 'none'; void n.offsetWidth;
          if (e.cls === 'entr') n.classList.remove('slhid');
          n.style.animation = effectAnim(e) + ' ' + Math.max(1, e.dur) + 'ms ' + start + 'ms both ease-out';
          if (e.cls === 'exit') setTimeout(() => { n.classList.add('slhid'); n.style.animation = ''; }, start + e.dur);
        });
        t = Math.max(t, start + e.dur);
      });
      return t;
    }
    function show(i, opt) {
      opt = opt || {};
      const old = stage.querySelector('.sl.on'), el = slideEl(i);
      el.classList.add('on');
      if (opt.final) { applySteps(el, i, deck.slides[i].steps.length); step = deck.slides[i].steps.length; } else step = 0;
      stage.appendChild(el);
      const tr = deck.slides[i].transition;
      if (old && opt.anim && tr && tr.type !== 'cut') {
        const dur = Math.max(200, tr.dur || 600), dir = tr.dir || 'l', D = { l: 'L', r: 'R', u: 'U', d: 'D' }[dir] || 'L';
        let inA = 'slTFade', outA = '';
        if (tr.type === 'push') { inA = 'slTIn' + D; outA = 'slTOut' + D; }
        else if (tr.type === 'cover' || tr.type === 'pull') inA = 'slTIn' + D;
        else if (tr.type === 'wipe') inA = 'slTWipe' + D;
        else if (tr.type === 'split') inA = 'slTSplit';
        else if (tr.type === 'zoom' || tr.type === 'vortex' || tr.type === 'ripple') inA = 'slTZoom';
        el.style.animation = inA + ' ' + dur + 'ms both ease-out';
        if (outA) old.style.animation = outA + ' ' + dur + 'ms both ease-out';
        setTimeout(() => old.remove(), dur + 30);
      } else if (old) old.remove();
      numEl.textContent = (i + 1) + ' / ' + deck.slides.length;
      idx = i; draw();
      if (opts.onSlide) opts.onSlide(i);
      clearTimeout(advTimer);
      const s = deck.slides[i];
      // passos automáticos no início (após a transição)
      if (!opt.final && s.steps[0] && s.steps[0].auto) { const wait = tr && opt.anim ? tr.dur || 500 : 0; setTimeout(() => { if (idx === i && step === 0) { playStep(stage.querySelector('.sl.on'), s.steps[0]); step = 1; } }, wait); }
      if (tr && tr.advTm != null) advTimer = setTimeout(() => { if (idx === i) next(); }, tr.advTm + (tr.dur || 0));
    }
    function next() {
      if (busy) return;
      const s = deck.slides[idx];
      if (step < s.steps.length) { playStep(stage.querySelector('.sl.on'), s.steps[step]); step++; while (step < s.steps.length && s.steps[step].auto) { playStep(stage.querySelector('.sl.on'), s.steps[step]); step++; } return; }
      if (idx < deck.slides.length - 1) show(idx + 1, { anim: true });
    }
    function prev() { if (idx > 0) show(idx - 1, { final: true }); else if (step > 0) show(0); }

    /* ---------- tinta ---------- */
    const list = () => (annots[idx] = annots[idx] || []);
    function strokePath(s, alpha) {
      if (!s.p.length) return;
      const W = cv.width, H = cv.height;
      cx.globalAlpha = alpha == null ? 1 : alpha; cx.strokeStyle = s.c; cx.lineWidth = Math.max(1, s.w * W); cx.lineCap = 'round'; cx.lineJoin = 'round';
      cx.beginPath(); cx.moveTo(s.p[0][0] * W, s.p[0][1] * H);
      if (s.p.length === 1) cx.lineTo(s.p[0][0] * W + 0.1, s.p[0][1] * H);
      for (let k = 1; k < s.p.length; k++) { const a = s.p[k - 1], b = s.p[k]; cx.quadraticCurveTo(a[0] * W, a[1] * H, (a[0] + b[0]) / 2 * W, (a[1] + b[1]) / 2 * H); }
      cx.stroke(); cx.globalAlpha = 1;
    }
    function draw() {
      cx.clearRect(0, 0, cv.width, cv.height);
      (annots[idx] || []).forEach((s) => strokePath(s));
      const now = Date.now();
      for (let k = temps.length - 1; k >= 0; k--) {
        const t = temps[k];
        if (t.slide !== idx) continue;
        const age = t.end ? now - t.end : 0, a = age < 2000 ? 1 : 1 - (age - 2000) / 800;
        if (a <= 0) { temps.splice(k, 1); continue; }
        cx.shadowColor = t.c; cx.shadowBlur = 8; strokePath(t, a); cx.shadowBlur = 0;
      }
      if (cur && tool !== 'erase') strokePath(cur, 1);
      if (temps.length) requestAnimationFrame(draw);
    }
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * 10000) / 10000, Math.round((e.clientY - r.top) / r.height * 10000) / 10000]; };
    function eraseAt(p) {
      const l = annots[idx]; if (!l) return false; const R = 0.02;
      const i = l.findIndex((s) => s.p.some((q) => Math.abs(q[0] - p[0]) < R && Math.abs(q[1] - p[1]) < R * deck.W / deck.H));
      if (i >= 0) { l.splice(i, 1); return true; } return false;
    }
    let downAt = null;
    cv.addEventListener('pointerdown', (e) => {
      if (tool === 'nav') { downAt = { x: e.clientX, y: e.clientY, t: Date.now() }; return; }
      cv.setPointerCapture(e.pointerId); e.preventDefault();
      const p = pt(e);
      if (tool === 'erase') { cur = { erase: true }; if (eraseAt(p)) { draw(); opts.onSave && opts.onSave(idx, annots[idx]); } return; }
      cur = { c: COLORS[color], w: WIDTHS[width] * (tool === 'temp' ? 1.2 : 1), p: [p] };
      if (tool === 'temp') { cur.slide = idx; temps.push(cur); }
      draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cur) return;
      const p = pt(e);
      if (cur.erase) { if (eraseAt(p)) { draw(); opts.onSave && opts.onSave(idx, annots[idx]); } return; }
      const last = cur.p[cur.p.length - 1]; if (Math.abs(last[0] - p[0]) + Math.abs(last[1] - p[1]) < 0.0015) return;
      cur.p.push(p); if (tool !== 'temp') draw();
    });
    const up = (e) => {
      if (tool === 'nav' && downAt) {
        const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y; const dt = Date.now() - downAt.t; downAt = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 800) { if (dx < 0) next(); else prev(); }
        else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) { const r = cv.getBoundingClientRect(); if (e.clientX - r.left < r.width * 0.2) prev(); else next(); }
        return;
      }
      if (!cur) return;
      if (!cur.erase) {
        if (tool === 'temp') { cur.end = Date.now(); requestAnimationFrame(draw); }
        else { list().push({ c: cur.c, w: cur.w, p: cur.p }); opts.onSave && opts.onSave(idx, annots[idx]); }
      }
      cur = null; draw();
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { cur = null; draw(); });

    /* ---------- barra e teclado ---------- */
    function setTool(t) { tool = t; root.dataset.tool = t; bar.querySelectorAll('[data-x="tool"]').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); }
    function setColor(i) { color = i; bar.querySelectorAll('[data-x="color"]').forEach((b, k) => b.classList.toggle('on', k === i)); if (tool === 'nav' || tool === 'erase') setTool('pen'); }
    function setWidth(i) { width = i; bar.querySelectorAll('[data-x="width"]').forEach((b, k) => b.classList.toggle('on', k === i)); }
    function full() { const d = document; if (d.fullscreenElement) d.exitFullscreen(); else if (root.requestFullscreen) root.requestFullscreen().catch(() => {}); else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen(); }
    function close() {
      clearTimeout(advTimer); window.removeEventListener('resize', fit); document.removeEventListener('keydown', key, true); document.removeEventListener('fullscreenchange', fit);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      root.remove(); if (opts.onClose) opts.onClose(idx);
    }
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const x = b.dataset.x;
      if (x === 'prev') prev(); else if (x === 'next') next(); else if (x === 'tool') setTool(b.dataset.t);
      else if (x === 'color') setColor(Number(b.dataset.i)); else if (x === 'width') setWidth(Number(b.dataset.i));
      else if (x === 'clear') { if ((annots[idx] || []).length && confirm('Apagar os desenhos deste slide?')) { annots[idx] = []; draw(); opts.onSave && opts.onSave(idx, []); } }
      else if (x === 'black') black.hidden = !black.hidden; else if (x === 'full') full(); else if (x === 'close') close();
    });
    function key(e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Enter' || k === 'ArrowDown') { e.preventDefault(); next(); }
      else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace' || k === 'ArrowUp') { e.preventDefault(); prev(); }
      else if (k === 'Home') show(0); else if (k === 'End') show(deck.slides.length - 1, { final: true });
      else if (k === 'b' || k === 'B' || k === '.') black.hidden = !black.hidden;
      else if (k === 'p' || k === 'P') setTool('pen'); else if (k === 't' || k === 'T') setTool('temp'); else if (k === 'e' || k === 'E') setTool('erase'); else if (k === 'n' || k === 'N') setTool('nav');
      else if (k === 'f' || k === 'F') full();
      else if (k === 'Escape' && !document.fullscreenElement) { e.preventDefault(); close(); }
      else return;
      e.stopPropagation();
    }
    // a barra some sozinha quando o mouse fica parado
    let hideT = 0;
    const wake = () => { root.classList.remove('idle'); clearTimeout(hideT); hideT = setTimeout(() => root.classList.add('idle'), 2600); };
    root.addEventListener('pointermove', wake); root.addEventListener('pointerdown', wake);
    window.addEventListener('resize', fit); document.addEventListener('keydown', key, true); document.addEventListener('fullscreenchange', fit);
    setTool('nav'); setColor(0); setTool('nav'); setWidth(1);
    fit(); show(idx); wake();
    if (opts.fullscreen) full();
    return { close: close, next: next, prev: prev, get index() { return idx; }, get step() { return step; } };
  }

  // miniatura estática (estado final do slide) dentro de um elemento
  function thumb(deck, i, box) {
    const s = deck.slides[i], d = document.createElement('div');
    d.className = 'sl slthumb'; d.style.width = deck.W + 'pt'; d.style.height = deck.H + 'pt'; d.style.background = s.bg; d.style.fontFamily = s.font; d.innerHTML = s.html;
    box.innerHTML = ''; box.appendChild(d);
    const k = box.clientWidth / (deck.W * 4 / 3); d.style.transform = 'scale(' + k + ')'; box.style.height = deck.H * 4 / 3 * k + 'px';
  }

  window.SlidesKit = { parse: parse, present: present, thumb: thumb, loadJSZip: loadJSZip };
})();
