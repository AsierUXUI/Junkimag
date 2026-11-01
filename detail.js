// Zine detail view: the content below and around the 3D zine when a zine is
// open (index.html?zine=<slug>). The 3D zine itself is drawn by hero.js.

import { makeCover, COVER_W, COVER_H } from './covers.js';
import { createGallery, createLightbox } from './gallery.js';

const CONFIG = {
  titleCounter: 1.05,       // the title counter-scrolls so it looks pinned
  scrollRange: 0.45,        // × viewport height (must match the zine choreography in hero.js)
  slideGap: 41, slideParallax: 0.12, snapDuration: 0.8,
  charStagger: 22, lineStagger: 80,   // ms
};

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createDetailView({ zines, onOpenZine, onHome, showPill }) {
  const root = $('detail');
  const logo = document.querySelector('.nav__logo');
  const titleEl = $('zine-title');
  let current = null, visible = false;

  if (reduce) document.documentElement.classList.add('reduced');

  // ── Smooth scroll (only while a zine is open) ──────────────────────
  const lenis = (window.Lenis && !reduce) ? new window.Lenis({ lerp: 0.1, smoothWheel: true }) : null;
  lenis?.stop();
  const scroll = () => (visible ? (lenis ? lenis.scroll : window.scrollY) : 0);

  // ── Text reveal (chars / lines in masks) ───────────────────────────
  function splitChars(el) {
    const delay = Number(el.dataset.delay || 0);
    const text = el.dataset.text ?? el.textContent;
    el.dataset.text = text;
    el.setAttribute('aria-label', text);
    let n = 0;
    el.innerHTML = text.split(/(\s+)/).map(part => {
      if (/^\s+$/.test(part)) return ' ';
      const chars = [...part].map(ch => `<span class="rvl-mask" aria-hidden="true"><span class="rvl-unit" style="--d:${delay + n++ * CONFIG.charStagger}">${esc(ch)}</span></span>`).join('');
      return `<span class="rvl-word">${chars}</span>`;
    }).join('');
    el.classList.add('is-split');
  }

  function splitLines(el) {
    const delay = Number(el.dataset.delay || 0);
    const chunks = el.dataset.src.split(/<br\s*\/?>/i).map(c => { const d = document.createElement('div'); d.innerHTML = c; return d.textContent.trim(); });
    el.innerHTML = chunks.map(c => c.split(/\s+/).filter(Boolean).map(w => `<span class="rvl-measure">${esc(w)}</span>`).join(' ')).join('<br>');
    const lines = []; let top = null;
    el.querySelectorAll('.rvl-measure, br').forEach(node => {
      if (node.tagName === 'BR') { top = null; return; }
      if (top === null || Math.abs(node.offsetTop - top) > 2) { lines.push([]); top = node.offsetTop; }
      lines[lines.length - 1].push(node.textContent);
    });
    el.innerHTML = lines.map((words, i) =>
      `<span class="rvl-line-mask"><span class="rvl-unit" style="--d:${delay + i * CONFIG.lineStagger}">${esc(words.join(' '))}</span></span>`).join('');
    el.classList.add('is-split');
  }

  const revealIO = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-revealed'); revealIO.unobserve(e.target); }
  }, { rootMargin: '0px 0px -12% 0px' });

  function setupReveals() {
    root.querySelectorAll('[data-reveal], [data-reveal-self]').forEach(el => { el.classList.remove('is-revealed'); revealIO.unobserve(el); });
    root.querySelectorAll('[data-reveal="chars"]').forEach(splitChars);
    root.querySelectorAll('[data-reveal="lines"]').forEach(el => {
      if (!el.dataset.src) el.dataset.src = el.innerHTML;
      splitLines(el);
    });
    root.querySelectorAll('[data-reveal], [data-reveal-self]').forEach(el => {
      if (reduce) el.classList.add('is-revealed'); else revealIO.observe(el);
    });
  }
  let resizeT;
  addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (visible) root.querySelectorAll('[data-reveal="lines"]:not(.is-revealed)').forEach(splitLines); slider.measure(); }, 200);
  });

  // ── Content ────────────────────────────────────────────────────────
  function render(zine) {
    document.title = `${zine.title} — Junki Magazine`;
    const inkA = zine.inks?.[0] || '#FF48B0';
    root.style.setProperty('--ink-a', inkA);
    root.style.setProperty('--tint', `color-mix(in srgb, ${inkA} 18%, #F2F0EB)`);

    titleEl.dataset.text = zine.title;
    $('hero-right').dataset.src = `${esc(zine.issue || '')}<br>${esc(zine.price || '')}`;
    $('hero-desc').dataset.src = esc(zine.intro || zine.description || '');
    $('hero-order').textContent = zine.price ? `Order a copy · ${zine.price}` : 'Order a copy';

    const cols = [
      zine.contents
        ? ['Includes', `<div class="zmeta__value">${zine.contents.map(esc).join('<br>')}</div>`]
        : ['Contributors', `<div class="zmeta__value">${(zine.contributors?.length ? zine.contributors : ['—']).map(esc).join('<br>')}</div>`],
      ['Format', `<div class="chips">${(zine.formats || ['A5']).map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>`],
      ['Price', `<div class="zmeta__value">${esc(zine.price || '—')}</div>`],
    ];
    $('zmeta-table').innerHTML = '<span class="zmeta__rule"></span>' + cols.map(([label, value]) =>
      `<div class="zmeta__col"><p class="label zmeta__label">${esc(label)}</p>${value}</div>`).join('');
    $('order-btn').textContent = zine.price ? `Order a copy · ${zine.price}` : 'Order a copy';

    buildOthers(zine);
    slider.setZine(zine);
  }

  for (const id of ['order-btn', 'hero-order']) $(id).addEventListener('click', () => current && window.JunkiOrder?.open(current.slug));
  // scroll hint: glide down to the details
  $('scroll-hint').addEventListener('click', () => {
    const y = $('zmeta').getBoundingClientRect().top + scroll() + innerHeight * 0.1;
    if (lenis) lenis.scrollTo(y, { duration: 1.4 }); else window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  });

  // ── Photo gallery: bending ribbon + lightbox (gallery.js) ──────────
  function mix(hex, amt) {
    const n = parseInt(hex.slice(1), 16), p = [0xF2, 0xF0, 0xEB];
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(p[i] + (v - p[i]) * amt));
    return `rgb(${c.join(',')})`;
  }

  async function sourcesFor(zine) {
    if (zine.spreads && zine.spreads.length) return zine.spreads;
    // Placeholders until real photos of the spreads are added in zines.js (spreads: [...])
    const inkA = zine.inks?.[0] || '#FF48B0', inkB = zine.inks?.[1] || '#0078BF';
    const [front, back] = await Promise.all([makeCover(zine, 'front', { cell: 8 }), makeCover(zine, 'back', { cell: 8 })]);
    const SW = 1600, SH = 1146, ch = 860, cw = ch * COVER_W / COVER_H;
    const make = draw => { const c = document.createElement('canvas'); c.width = SW; c.height = SH; draw(c.getContext('2d')); return c.toDataURL('image/jpeg', 0.86); };
    const shadow = (ctx, fn) => { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18; fn(); ctx.restore(); };
    return [
      make(ctx => { ctx.fillStyle = mix(inkA, 0.22); ctx.fillRect(0, 0, SW, SH);
        shadow(ctx, () => { ctx.drawImage(back, SW / 2 - cw, (SH - ch) / 2, cw, ch); ctx.drawImage(front, SW / 2, (SH - ch) / 2, cw, ch); }); }),
      make(ctx => { ctx.fillStyle = mix(inkB, 0.25); ctx.fillRect(0, 0, SW, SH);
        ctx.translate(SW / 2, SH / 2); ctx.rotate(-0.08); shadow(ctx, () => ctx.drawImage(front, -cw / 2, -ch / 2, cw, ch)); }),
      make(ctx => { ctx.fillStyle = '#F4F1EA'; ctx.fillRect(0, 0, SW, SH);
        ctx.fillStyle = inkB; for (let y = 20; y < SH; y += 26) for (let x = 20 + (y / 26 % 2) * 13; x < SW; x += 26) { const r = 9 * (x / SW); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#111'; ctx.font = '700 44px "Space Mono", monospace'; ctx.textAlign = 'center';
        ctx.fillText('SPREAD PHOTOS COMING SOON', SW / 2, SH / 2 + 15); }),
      make(ctx => { ctx.fillStyle = mix(inkA, 0.4); ctx.fillRect(0, 0, SW, SH);
        ctx.translate(SW / 2, SH / 2); ctx.rotate(0.06); shadow(ctx, () => ctx.drawImage(back, -cw / 2, -ch / 2, cw, ch)); }),
    ];
  }

  const lightbox = createLightbox({
    onOpen: () => { lenis?.stop(); gallery.setPaused(true); },
    onClose: () => { if (visible) lenis?.start(); gallery.setPaused(false); },
  });
  const pin = $('ribbon-pin');
  const gallery = createGallery({ root: $('slider'), showPill, onLightbox: (srcs, i, from) => lightbox.open(srcs, i, from) });
  let galleryToken = 0;
  const slider = {
    async setZine(zine) {
      const my = ++galleryToken;
      const srcs = await sourcesFor(zine);
      if (my === galleryToken) gallery.setSources(srcs);
    },
    tick() {},
    measure() { gallery.measure(); },
  };

  // ── Other issues ───────────────────────────────────────────────────
  const row = $('others-row');
  const coverCache = new Map();
  let othersIO = null;
  function buildOthers(zine) {
    const others = zines.filter(z => z.slug !== zine.slug);
    row.scrollLeft = 0;
    row.innerHTML = others.map(z => `
      <a class="card" href="index.html?zine=${encodeURIComponent(z.slug)}" style="--ink-a:${esc(z.inks?.[0] || '#FF48B0')}" data-slug="${esc(z.slug)}">
        <span class="card__name"><strong>${esc(z.title)}</strong><span class="label">${esc(z.price || '')}</span></span>
        <img class="card__cover" alt="" draggable="false">
        <span class="card__pill">See this issue</span>
      </a>`).join('');
    // covers are generated when the row comes close to the screen
    othersIO?.disconnect();
    othersIO = new IntersectionObserver(async entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      othersIO.disconnect();
      for (const card of row.querySelectorAll('.card')) {
        const z = others.find(o => o.slug === card.dataset.slug);
        if (!coverCache.has(z.slug)) coverCache.set(z.slug, (await makeCover(z, 'front', { cell: 9 })).toDataURL('image/jpeg', 0.85));
        card.querySelector('.card__cover').src = coverCache.get(z.slug);
      }
    }, { rootMargin: '600px 0px' });
    othersIO.observe(row);
  }
  // drag to scroll with a mouse; a drag doesn't count as a click
  let d = null;
  row.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.button > 0) return; d = { x: e.clientX, s: row.scrollLeft, moved: false }; });
  addEventListener('pointermove', e => {
    if (!d) return;
    if (Math.abs(e.clientX - d.x) > 5) { d.moved = true; row.classList.add('is-dragging'); }
    if (d.moved) row.scrollLeft = d.s - (e.clientX - d.x);
  });
  addEventListener('pointerup', () => { if (d && d.moved) row.dataset.justDragged = '1'; d = null; row.classList.remove('is-dragging'); setTimeout(() => delete row.dataset.justDragged, 0); });
  row.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    if (row.dataset.justDragged) return;
    onOpenZine(card.dataset.slug);
  });
  row.addEventListener('dragstart', e => e.preventDefault());

  // links back to the carousel stay on this page
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-home]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
    e.preventDefault();
    onHome();
  });

  // ── Show / hide ────────────────────────────────────────────────────
  function jumpTop() {
    if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
    window.scrollTo(0, 0);
  }

  function show(zine) {
    current = zine;
    jumpTop();
    render(zine);
    visible = true;
    document.documentElement.classList.add('is-detail');
    root.setAttribute('aria-hidden', 'false');
    // restart the fade-in when switching between zines
    root.style.animation = 'none'; void root.offsetWidth; root.style.animation = '';
    setupReveals();
    lenis?.start();
    jumpTop();
  }

  function hide() {
    jumpTop();
    visible = false;
    current = null;
    lenis?.stop();
    document.documentElement.classList.remove('is-detail');
    root.setAttribute('aria-hidden', 'true');
    root.querySelectorAll('[data-reveal], [data-reveal-self]').forEach(el => { el.classList.remove('is-revealed'); revealIO.unobserve(el); });
    root.classList.remove('is-scrolled'); root.style.setProperty('--lead-o', '1');
    showPill(null);
    logo.style.setProperty('--logo-s', '1');
  }

  function tick(now) {
    if (lenis) lenis.raf(now);
    if (!visible) return;
    const sy = scroll();
    const range = CONFIG.scrollRange * innerHeight;
    titleEl.style.setProperty('--title-y', (Math.min(Math.max(sy, 0), range) * CONFIG.titleCounter).toFixed(1) + 'px');
    logo.style.setProperty('--logo-s', lerp(1, 0.66, clamp(sy / 150, 0, 1)).toFixed(3));
    // the description and button fade as the zine rises over them; the hint goes once you scroll
    root.style.setProperty('--lead-o', (1 - clamp((sy - range * 0.35) / (range * 0.5), 0, 1)).toFixed(3));
    root.classList.toggle('is-scrolled', sy > 30);
    slider.tick(now);
    // scrolling through the pinned gallery section moves the ribbon
    const pr = pin.getBoundingClientRect();
    gallery.setScrollProgress(clamp(-pr.top / Math.max(1, pr.height - innerHeight), 0, 1));
  }

  return { show, hide, tick, scroll, get zine() { return current; } };
}
