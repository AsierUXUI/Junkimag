// Zine detail page (zine.html?zine=<slug>).
// The zine peeks up from the bottom, then rises, tilts, shrinks and flips
// once (front → back → front) over the first ~45% of a screen of scrolling,
// passing over a giant title that stays nearly fixed.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeCover, waitForFonts, COVER_W, COVER_H } from './covers.js';
import { createZineKit } from './zine-mesh.js';

const CONFIG = {
  scrollRange: 0.45,        // × viewport height: scroll distance for the whole choreography
  riseBy: 0.24,             // × viewport height the zine rises
  tilt: 20,                 // degrees, clockwise
  scaleFrom: 1.25, scaleTo: 0.8,
  mobileScaleFrom: 1.1, mobileScaleTo: 0.75,
  titleCounter: 1.05,       // title counter-scroll factor (looks pinned)
  arriveDuration: 1.1,      // s, when coming from the home page carousel
  exposure: 1.0,
  slideGap: 41, slideParallax: 0.12, snapDuration: 0.8,
  charStagger: 22, lineStagger: 80,   // ms
};

const ZINES = window.JUNKI_ZINES || [];
const params = new URLSearchParams(location.search);
const zine = ZINES.find(z => z.slug === params.get('zine')) || ZINES[0];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hoverable = matchMedia('(hover: hover)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const detailUrl = z => 'zine.html?zine=' + encodeURIComponent(z.slug);

if (reduce) document.documentElement.classList.add('reduced');

// ── Content ──────────────────────────────────────────────────────────
document.title = `${zine.title} — Junki Magazine`;
const inkA = zine.inks?.[0] || '#FF48B0', inkB = zine.inks?.[1] || '#0078BF';
document.documentElement.style.setProperty('--ink-a', inkA);
document.documentElement.style.setProperty('--tint', `color-mix(in srgb, ${inkA} 18%, #F2F0EB)`);

$('zine-title').textContent = zine.title;
$('hero-right').innerHTML = `${esc(zine.issue || '')}<br>${esc(zine.price || '')}`;
$('intro-text').textContent = zine.intro || zine.description || '';

const metaCols = [
  ['Contributors', `<div class="zmeta__value">${(zine.contributors || ['—']).map(esc).join('<br>')}</div>`],
  ['Format', `<div class="chips">${(zine.formats || ['A5']).map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>`],
  ['Price', `<div class="zmeta__value">${esc(zine.price || '—')}</div>`],
];
$('zmeta-table').insertAdjacentHTML('beforeend', metaCols.map(([label, value]) =>
  `<div class="zmeta__col"><p class="label zmeta__label">${esc(label)}</p>${value}</div>`).join(''));
$('order-btn').textContent = zine.price ? `Order a copy · ${zine.price}` : 'Order a copy';

document.querySelectorAll('[data-order]').forEach(b => b.addEventListener('click', () => window.JunkiOrder?.open(zine.title)));

// ── Smooth scroll ────────────────────────────────────────────────────
let lenis = null;
if (window.Lenis && !reduce) {
  lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true });
}
const scrollY = () => (lenis ? lenis.scroll : window.scrollY);

// ── Text reveal (chars / lines in masks) ─────────────────────────────
function splitChars(el) {
  const delay = Number(el.dataset.delay || 0);
  const text = el.textContent;
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
  if (!el.dataset.src) el.dataset.src = el.innerHTML;
  const delay = Number(el.dataset.delay || 0);
  // explicit <br> breaks first, then wrap by measuring where words land
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
  document.querySelectorAll('[data-reveal="chars"]').forEach(splitChars);
  document.querySelectorAll('[data-reveal="lines"]').forEach(splitLines);
  document.querySelectorAll('[data-reveal], [data-reveal-self]').forEach(el => {
    if (reduce) el.classList.add('is-revealed'); else revealIO.observe(el);
  });
  // re-split lines on resize, but only those that haven't played yet
  let t;
  addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => document.querySelectorAll('[data-reveal="lines"]:not(.is-revealed)').forEach(splitLines), 200);
  });
}

// ── Cursor pill ──────────────────────────────────────────────────────
const pill = $('cursor-pill'), pillText = $('cursor-pill-text');
const pointer = { x: -100, y: -100, px: -100, py: -100, nx: 0, ny: 0 };
addEventListener('pointermove', e => {
  pointer.x = e.clientX; pointer.y = e.clientY;
  pointer.nx = e.clientX / innerWidth * 2 - 1; pointer.ny = e.clientY / innerHeight * 2 - 1;
});
function showPill(text) { if (!hoverable) return; if (text) pillText.textContent = text; pill.classList.toggle('is-visible', !!text); }

// ── Hero: 3D zine driven by scroll ───────────────────────────────────
const glCanvas = $('gl'), stage = $('stage'), titleEl = $('zine-title');
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }

const hero = renderer ? initHero() : null;

function initHero() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  // light stays fixed from the left while the zine turns under it
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(-1, 0.35, 0.9);
  const fill = new THREE.DirectionalLight(0xfff4ea, 0.45); fill.position.set(1, -0.2, 0.6);
  scene.add(key, fill);

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 20000);
  const kit = createZineKit(renderer, { height: 1, thickness: 0.006 });
  const z3 = kit.build(zine);
  const holder = new THREE.Group(); holder.add(z3.inner); scene.add(holder);

  let W = 0, Hc = 0, vh = 0, H0 = 0, mobile = false;
  function resize() {
    W = glCanvas.clientWidth; Hc = glCanvas.clientHeight; vh = stage.clientHeight;
    mobile = W < 768;
    renderer.setSize(W, Hc, false);
    camera.aspect = W / Hc;
    // place the camera so one world unit is one CSS pixel on the z = 0 plane
    camera.position.set(0, 0, (Hc / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.near = camera.position.z / 10; camera.far = camera.position.z * 10;
    camera.updateProjectionMatrix();
    H0 = mobile ? Math.min(0.7 * W / 0.705, 0.8 * vh) : Math.min(0.569 * W, 0.85 * vh);
    state.dirty = true;
  }

  const state = { dirty: true, last: '', arrive: 1, arriveStart: 0, tiltX: 0, tiltY: 0, ready: false };
  try {
    if (sessionStorage.getItem('junki-flight') === zine.slug && !reduce) { state.arrive = 0; }
    sessionStorage.removeItem('junki-flight');
  } catch (e) {}

  function pose(sy) {
    const p = clamp(sy / (CONFIG.scrollRange * vh), 0, 1);
    const s0 = mobile ? CONFIG.mobileScaleFrom : CONFIG.scaleFrom, s1 = mobile ? CONFIG.mobileScaleTo : CONFIG.scaleTo;
    return {
      p,
      cy: 0.8 * vh + H0 / 2 - CONFIG.riseBy * vh * p,   // centre, in px from the top of the page
      rotZ: -THREE.MathUtils.degToRad(CONFIG.tilt) * p,
      scale: lerp(s0, s1, p),
      flip: p * Math.PI * 2,
    };
  }

  function frame(now) {
    const sy = scrollY();
    let P = pose(sy);
    // coming from the home page: fly in from the middle of the screen
    if (state.arrive < 1 && state.ready) {
      if (!state.arriveStart) state.arriveStart = now;
      state.arrive = clamp((now - state.arriveStart) / 1000 / CONFIG.arriveDuration, 0, 1);
      const e = easeInOutCubic(state.arrive);
      P = { ...P, cy: lerp(sy + 0.5 * vh, P.cy, e), scale: lerp(0.62, P.scale, e), rotZ: lerp(0, P.rotZ, e), flip: lerp(-0.5, P.flip, e), rx: lerp(0.18, 0, e) };
    }
    // gentle tilt toward the pointer
    if (hoverable && !reduce) {
      state.tiltX += (pointer.ny * 0.06 - state.tiltX) * 0.08;
      state.tiltY += (pointer.nx * 0.08 - state.tiltY) * 0.08;
    }
    const key = [P.cy, P.scale, P.flip, state.tiltX, state.tiltY, W, Hc].map(v => v.toFixed(4)).join();
    if (key !== state.last || state.dirty) {
      state.last = key; state.dirty = false;
      holder.position.set(0, Hc / 2 - P.cy, 0);
      holder.scale.setScalar(H0 * P.scale);
      holder.rotation.set(0, 0, P.rotZ);
      z3.inner.rotation.set((P.rx || 0) + state.tiltX, P.flip + state.tiltY, 0);
      renderer.render(scene, camera);
    }
    // the title counter-scrolls so it looks pinned while the zine passes over it
    const range = CONFIG.scrollRange * vh;
    titleEl.style.setProperty('--title-y', (Math.min(Math.max(sy, 0), range) * CONFIG.titleCounter).toFixed(1) + 'px');
  }

  addEventListener('resize', resize);
  resize();

  (async () => {
    await kit.loadTextures(z3, zine);
    renderer.compile(scene, camera);
    state.ready = true; state.dirty = true;
    glCanvas.classList.add('is-ready');
  })();

  return { frame };
}

// ── Photo slider ─────────────────────────────────────────────────────
async function buildSlides() {
  const slider = $('slider');
  const [front, back] = await Promise.all([makeCover(zine, 'front', { cell: 8 }), makeCover(zine, 'back', { cell: 8 })]);
  const SW = 1600, SH = 1146;
  const make = draw => { const c = document.createElement('canvas'); c.width = SW; c.height = SH; draw(c.getContext('2d')); return c.toDataURL('image/jpeg', 0.86); };
  const shadow = (ctx, fn) => { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18; fn(); ctx.restore(); };
  const ch = 860, cw = ch * COVER_W / COVER_H;

  const sources = (zine.spreads && zine.spreads.length) ? zine.spreads : [
    // Placeholders until real photos of the spreads are added in zines.js (spreads: [...])
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

  const slides = sources.map((src, i) => {
    const el = document.createElement('div'); el.className = 'slide';
    el.setAttribute('role', 'group'); el.setAttribute('aria-label', `${i + 1} of ${sources.length}`);
    const img = new Image(); img.className = 'slide__img'; img.alt = ''; img.src = src; img.draggable = false;
    el.appendChild(img); slider.appendChild(el);
    return { el, img };
  });
  return { slider, slides };
}

function mix(hex, amt) {
  const n = parseInt(hex.slice(1), 16), p = [0xF2, 0xF0, 0xEB];
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(p[i] + (v - p[i]) * amt));
  return `rgb(${c.join(',')})`;
}

function initSlider({ slider, slides }) {
  const N = slides.length;
  let step = 0, offset = 0, anim = null, drag = null, wheelTimer = null;
  const measure = () => { step = slides[0].el.offsetWidth + CONFIG.slideGap; };
  measure(); addEventListener('resize', () => { measure(); snapTo(Math.round(offset / step) * step, 0); });

  function layout() {
    const L = N * step, sw = slides[0].el.offsetWidth;
    slides.forEach((s, i) => {
      let x = ((i * step + offset) % L + L) % L;
      if (x > L / 2) x -= L;
      s.el.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
      const shift = clamp(-x * CONFIG.slideParallax, -0.15 * sw, 0.15 * sw);
      s.img.style.transform = `translate3d(${shift.toFixed(1)}px,0,0)`;
    });
  }
  function snapTo(target, duration = CONFIG.snapDuration) {
    if (!duration || reduce) { offset = target; anim = null; layout(); return; }
    anim = { from: offset, to: target, start: performance.now(), dur: duration * 1000 };
  }
  function tick(now) {
    if (anim) {
      const t = clamp((now - anim.start) / anim.dur, 0, 1);
      offset = lerp(anim.from, anim.to, easeOutCubic(t));
      if (t >= 1) anim = null;
      layout();
    }
  }

  slider.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    drag = { x0: e.clientX, o0: offset, lastX: e.clientX, lastT: performance.now(), v: 0 };
    anim = null; slider.classList.add('is-dragging'); slider.setPointerCapture(e.pointerId);
  });
  slider.addEventListener('pointermove', e => {
    if (!drag) return;
    const now = performance.now(), dt = Math.max(1, now - drag.lastT);
    drag.v = lerp(drag.v, (e.clientX - drag.lastX) / dt, 0.4); drag.lastX = e.clientX; drag.lastT = now;
    offset = drag.o0 + (e.clientX - drag.x0); layout();
  });
  const end = () => {
    if (!drag) return;
    const thrown = offset + drag.v * 220;   // inertia
    drag = null; slider.classList.remove('is-dragging');
    snapTo(Math.round(thrown / step) * step);
  };
  slider.addEventListener('pointerup', end);
  slider.addEventListener('pointercancel', end);
  // horizontal trackpad swipes move the slider; vertical scrolling passes through
  slider.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault(); anim = null;
    offset -= e.deltaX; layout();
    clearTimeout(wheelTimer); wheelTimer = setTimeout(() => snapTo(Math.round(offset / step) * step), 140);
  }, { passive: false });
  slider.addEventListener('pointerenter', () => showPill('Drag'));
  slider.addEventListener('pointerleave', () => showPill(null));
  slider.setAttribute('data-lenis-prevent-touch', '');

  layout();
  return { tick };
}

// ── Other issues ─────────────────────────────────────────────────────
function buildOthers() {
  const row = $('others-row');
  const others = ZINES.filter(z => z.slug !== zine.slug);
  row.innerHTML = others.map(z => `
    <a class="card" href="${detailUrl(z)}" style="--ink-a:${esc(z.inks?.[0] || '#FF48B0')}" data-slug="${esc(z.slug)}">
      <span class="card__name"><strong>${esc(z.title)}</strong><span class="label">${esc(z.price || '')}</span></span>
      <img class="card__cover" alt="" draggable="false">
      <span class="card__pill">See this issue</span>
    </a>`).join('');
  // covers are generated when the row comes close to the screen
  const io = new IntersectionObserver(async entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    io.disconnect();
    for (const card of row.querySelectorAll('.card')) {
      const z = others.find(o => o.slug === card.dataset.slug);
      const c = await makeCover(z, 'front', { cell: 9 });
      card.querySelector('.card__cover').src = c.toDataURL('image/jpeg', 0.85);
    }
  }, { rootMargin: '600px 0px' });
  io.observe(row);

  // drag to scroll with a mouse; a drag doesn't count as a click
  let d = null;
  row.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.button > 0) return; d = { x: e.clientX, s: row.scrollLeft, moved: false }; });
  addEventListener('pointermove', e => {
    if (!d) return;
    if (Math.abs(e.clientX - d.x) > 5) { d.moved = true; row.classList.add('is-dragging'); }
    if (d.moved) row.scrollLeft = d.s - (e.clientX - d.x);
  });
  addEventListener('pointerup', () => { if (d && d.moved) row.dataset.justDragged = '1'; d = null; row.classList.remove('is-dragging'); setTimeout(() => delete row.dataset.justDragged, 0); });
  row.addEventListener('click', e => { if (row.dataset.justDragged) e.preventDefault(); }, true);
  row.addEventListener('dragstart', e => e.preventDefault());
}

// ── Header compacts on scroll ────────────────────────────────────────
const logo = document.querySelector('.nav__logo');
function headerFrame(sy) {
  const t = clamp(sy / 150, 0, 1);
  logo.style.setProperty('--logo-s', lerp(1, 0.66, t).toFixed(3));
}

// ── Main loop ────────────────────────────────────────────────────────
let slider = null;
function loop(now) {
  requestAnimationFrame(loop);
  if (lenis) lenis.raf(now);
  const sy = scrollY();
  headerFrame(sy);
  if (hero) hero.frame(now);
  if (slider) slider.tick(now);
  pointer.px += (pointer.x - pointer.px) * 0.25; pointer.py += (pointer.y - pointer.py) * 0.25;
  pill.style.setProperty('--x', pointer.px.toFixed(1) + 'px'); pill.style.setProperty('--y', pointer.py.toFixed(1) + 'px');
}

(async () => {
  await waitForFonts();
  setupReveals();
  buildOthers();
  requestAnimationFrame(loop);
  slider = initSlider(await buildSlides());
})();
