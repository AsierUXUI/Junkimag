// Ribbon gallery for a zine's photos (detail view).
// The photos sit on one bending "ribbon": an S-curve in depth that the cards
// travel through, banking along its slope. Dragging fast makes it dive deeper
// and wring at the edges. Hovering a card dents its centre in. Clicking opens
// the photo large in a lightbox (← → to browse, Esc to close).
// Technique after a write-up of jesperlandberg.com's home carousel; this is
// our own implementation, tuned for a paper background instead of black.

import * as THREE from 'three';

const CONFIG = {
  cardHeight: 0.62,      // × gallery height
  gap: 14, radius: 16,   // px
  lerp: 0.1,             // per 60fps frame
  dragFactor: 1.5, flick: 12, wheelFactor: 1.25,
  velocityNorm: 550,     // px of lag that reads as full speed
  depth: 0.2, depthSpeed: 1.1, span: 1.15, lean: -0.12,
  dent: 0.1,
  haze: 0.4,             // how far the far side fades toward the paper colour
  mobileBend: 0.45,      // ribbon strength on phones
};

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const SHEET = /* glsl */`
uniform float uSheetW, uSheetD, uSheetT, uSheetP, uSheetV, uHover, uDent, uLeanA;
const float PI = 3.141592653589793;
const float BANK = -0.16, DIAG = 0.03, REAR_Y = 0.10, REAR_Z = 0.20, VTWIST = 1.6, TAIL = 1.0, SHIFT = -0.2;
float sheetQ(float x) { return x / max(uSheetW, 1e-4) * uSheetT + SHIFT; }
float sheetShape(float q) { return sin(PI * q) * exp(-TAIL * q * q); }
float sheetSlope(float q) { float g = exp(-TAIL * q * q); return (PI * cos(PI * q) - 2.0 * TAIL * q * sin(PI * q)) * g; }
float sheetZ(float x) { return -uSheetD * sheetShape(sheetQ(x)); }
float sheetRoll(float x) { return uSheetW < 1e-3 ? 0.0 : BANK * sheetSlope(sheetQ(x)) / PI * uSheetP; }
float leanRamp(float s) { s = clamp(s, -1.0, 1.0); return s * (1.5 - 0.5 * s * s); }
float leanSlope(float s) { s = min(abs(s), 1.0); return 1.5 * (1.0 - s * s); }
float dome(vec2 uv) { vec2 q = uv * 2.0 - 1.0; return (1.0 - q.x * q.x) * (1.0 - q.y * q.y); }
`;

const VERT = /* glsl */`
${SHEET}
varying vec2 vUv; varying vec3 vFlat;
uniform vec2 uRes;
vec4 wind(vec4 w) {
  float a = sheetRoll(w.x);
  if (uSheetV > 1e-3 && uSheetW > 1e-3) { float qe = w.x / uSheetW; a += VTWIST * uSheetV * smoothstep(0.3, 0.9, abs(qe)) * sign(qe) * uSheetP; }
  float s = sin(a), c = cos(a);
  return vec4(w.x, w.y * c - w.z * s, w.y * s + w.z * c, w.w);
}
void main() {
  vUv = uv;
  vFlat = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 p = position;
  p.z -= uHover * uDent * uRes.y * dome(uv);          // hover: the centre bows away, edges stay put
  vec4 w = modelMatrix * vec4(p, 1.0);
  w = wind(w);                                         // roll first, then bend
  w.z += sheetZ(w.x) * uSheetP;
  if (uSheetW > 1e-3) {
    float qw = w.x / uSheetW;
    w.y += DIAG * w.x * uSheetP;
    float m = 1.0 - smoothstep(-1.0, 0.3, qw);         // speed lifts the left side toward you
    w.y += REAR_Y * uSheetW * uSheetV * m * uSheetP;
    w.z += REAR_Z * uSheetW * uSheetV * m * uSheetP;
    w.z += uLeanA * leanRamp(qw) * uSheetP;
  }
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */`
${SHEET}
uniform sampler2D uTexture; uniform vec2 uSize, uRes; uniform float uAlpha, uCorner, uHaze; uniform vec3 uPaper;
varying vec2 vUv; varying vec3 vFlat;
vec2 cover(vec2 plane, vec2 img, vec2 uv) {
  float pr = plane.x / plane.y, ir = img.x / img.y;
  vec2 ns = pr < ir ? vec2(img.x * (plane.y / img.y), plane.y) : vec2(plane.x, img.y * (plane.x / img.x));
  vec2 off = (pr < ir ? vec2((ns.x - plane.x) / 2.0, 0.0) : vec2(0.0, (ns.y - plane.y) / 2.0)) / ns;
  return uv * plane / ns + off;
}
float roundedBox(vec2 p, vec2 mid, float r) { vec2 q = abs(p - mid) - (mid - r); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec4 tex = texture2D(uTexture, cover(uRes, uSize, vUv));
  vec3 col = tex.rgb;
  // far side of the ribbon fades into the paper; near side stays crisp
  if (uSheetD > 1e-3) {
    float d = clamp((uSheetD - sheetZ(vFlat.x)) / (2.0 * uSheetD), 0.0, 1.0) * uSheetP;
    d += uHover * uDent * uRes.y * dome(vUv) / (2.0 * uSheetD);
    col = mix(col, uPaper, uHaze * clamp(d, 0.0, 1.0) * clamp(d, 0.0, 1.0));
  }
  // analytic normal for a soft sheen that slides across as cards move through the bend
  float dzdx = -uSheetD * sheetSlope(sheetQ(vFlat.x)) * uSheetT / max(uSheetW, 1e-4) * uSheetP;
  dzdx += (uLeanA / max(uSheetW, 1e-4)) * leanSlope(vFlat.x / max(uSheetW, 1e-4)) * uSheetP;
  vec2 q = vUv * 2.0 - 1.0; float a = uHover * uDent;
  dzdx += 4.0 * a * uRes.y * q.x * (1.0 - q.y * q.y) / max(uRes.x, 1e-4);
  float dzdy = 4.0 * a * q.y * (1.0 - q.x * q.x);
  vec3 n = normalize(vec3(-dzdx, -dzdy, 1.0));
  vec3 L = normalize(vec3(-0.4, 0.5, 1.0));
  float diff = dot(n, L) * 0.5 + 0.5;
  col *= 1.0 - 0.14 * (1.0 - diff);
  col += pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 48.0) * 0.22;
  float alpha = uAlpha;
  vec2 sz = vec2(uRes.x / max(uRes.y, 1e-4), 1.0), mid = sz * 0.5;
  float dd = roundedBox(vUv * sz, mid, min(uCorner, min(mid.x, mid.y)));
  float aa = max(fwidth(dd), 1e-4);
  alpha *= 1.0 - smoothstep(-aa, aa, dd);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

export function createGallery({ root, showPill, onLightbox }) {
  // ── DOM ────────────────────────────────────────────────────────────
  root.classList.add('ribbon');
  root.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.className = 'ribbon__gl';
  canvas.setAttribute('aria-hidden', 'true');
  const list = document.createElement('ul');   // accessible copy: real buttons for keyboard and screen readers
  list.className = 'ribbon__list sr-only';
  root.append(canvas, list);

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { renderer = null; }
  if (renderer) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(53.4, 1, 0.1, 2000);
  camera.position.z = 41.18;
  const geo = new THREE.PlaneGeometry(1, 1, 24, 24);
  const shared = {
    uSheetW: { value: 0 }, uSheetD: { value: 0 }, uSheetT: { value: CONFIG.span }, uSheetP: { value: 1 },
    uSheetV: { value: 0 }, uLeanA: { value: 0 }, uDent: { value: CONFIG.dent },
    uHaze: { value: CONFIG.haze }, uPaper: { value: new THREE.Color('#F2F0EB') },
  };
  const loader = new THREE.TextureLoader();

  let cards = [], sources = [], W = 0, H = 0, cardH = 0, total = 0;
  let target = 0, current = 0, vel = 0, hover = -1, visible = false, running = false, token = 0;
  let drag = null, justDragged = false;

  // ── Layout ─────────────────────────────────────────────────────────
  function measure() {
    W = root.clientWidth; H = root.clientHeight;
    if (!W || !H) return;
    // the canvas overhangs the section so the bend never clips
    const over = 0.25;
    canvas.style.top = `${-H * over}px`; canvas.style.height = `${H * (1 + 2 * over)}px`;
    renderer?.setSize(W, H * (1 + 2 * over), false);
    camera.aspect = W / (H * (1 + 2 * over)); camera.updateProjectionMatrix();
    cardH = H * CONFIG.cardHeight;
    let x = 0;
    for (const c of cards) { c.w = cardH * c.aspect; c.left = x; x += c.w + CONFIG.gap; }
    total = x;
  }

  // CSS px rect (relative to the section) → plane position/scale in world space
  function pose(c, left) {
    const ch = H * 1.5;   // canvas height in px (section × (1 + 2 × overhang))
    const fullH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.z;
    const fullW = fullH * camera.aspect;
    const top = H * 0.25 + (H - cardH) / 2;
    const sx = fullW * (c.w / W), sy = fullH * (cardH / ch);
    c.mesh.position.set(-fullW / 2 + sx / 2 + left / W * fullW, fullH / 2 - sy / 2 - top / ch * fullH, 0);
    c.mesh.scale.set(sx, sy, 1);
    c.mat.uniforms.uRes.value.set(sx, sy);
    c.mat.uniforms.uCorner.value = CONFIG.radius / cardH;
  }

  // each card wraps on its own around the centre, so the strip never ends
  function wrappedLeft(c) {
    const min = W / 2 - total / 2;
    let x = c.left - current;
    return ((x - min) % total + total) % total + min;
  }

  // ── Content ────────────────────────────────────────────────────────
  async function setSources(list_) {
    const my = ++token;
    for (const c of cards) { scene.remove(c.mesh); c.mat.dispose(); c.tex?.dispose(); }
    cards = []; sources = list_;
    list.innerHTML = sources.map((_, i) => `<li><button type="button" data-i="${i}">Open photo ${i + 1} of ${sources.length}</button></li>`).join('');
    const imgs = await Promise.all(sources.map(src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; })));
    if (my !== token) return;
    // fewer photos than ~2.5 screens wide: repeat them so the loop has no gaps
    const base = imgs.map((im, i) => ({ im, i })).filter(o => o.im);
    if (!base.length) return;
    let pool = base.slice();
    const estW = () => pool.reduce((s, o) => s + (root.clientHeight * CONFIG.cardHeight) * (o.im.width / o.im.height) + CONFIG.gap, 0);
    while (estW() < root.clientWidth * 2.6 && pool.length < 40) pool = pool.concat(base);
    cards = pool.map(({ im, i }, k) => {
      const tex = new THREE.Texture(im); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
        uniforms: { ...shared, uTexture: { value: tex }, uSize: { value: new THREE.Vector2(im.width, im.height) },
          uRes: { value: new THREE.Vector2(1, 1) }, uAlpha: { value: 0 }, uCorner: { value: 0.05 }, uHover: { value: 0 } },
      });
      const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = k;
      scene.add(mesh);
      return { mesh, mat, tex, i, aspect: im.width / im.height, w: 0, left: 0, alpha: 0, hover: 0, born: performance.now() + k * 50 };
    });
    measure();
    current = target = cards[0].left + cards[0].w / 2 - W / 2;   // first photo centred
    wake();
  }

  // ── Frame ──────────────────────────────────────────────────────────
  let lastT = 0;
  function frame(now) {
    if (!visible || !renderer) { running = false; return; }
    requestAnimationFrame(frame);
    const ratio = lastT ? Math.min((now - lastT) / (1000 / 60), 3) : 1; lastT = now;
    const k = 1 - Math.pow(1 - CONFIG.lerp, ratio);
    current += (target - current) * (reduce ? 1 : k);
    const n = Math.tanh((target - current) / CONFIG.velocityNorm);
    vel = reduce ? 0 : n * Math.abs(n);

    const fullH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.z;
    const halfW = fullH * camera.aspect / 2;
    const V = Math.min(1, Math.abs(vel));
    const bend = (W < 650 ? CONFIG.mobileBend : 1) * (reduce ? 0.6 : 1);
    shared.uSheetW.value = halfW;
    shared.uSheetD.value = halfW * CONFIG.depth * (1 + CONFIG.depthSpeed * V) * bend;
    shared.uSheetV.value = V * bend;
    shared.uSheetP.value = 1;
    shared.uLeanA.value = halfW * CONFIG.lean * bend;

    let busy = Math.abs(target - current) > 0.05;
    for (const c of cards) {
      pose(c, wrappedLeft(c));
      const a = now >= c.born ? 1 : 0;
      c.alpha += (a - c.alpha) * (reduce ? 1 : 0.08);
      c.hover += ((hover >= 0 && cards[hover] === c ? 1 : 0) - c.hover) * (reduce ? 1 : 0.12);
      c.mat.uniforms.uAlpha.value = c.alpha;
      c.mat.uniforms.uHover.value = c.hover;
      if (Math.abs(a - c.alpha) > 0.002 || c.hover > 0.002 && c.hover < 0.998) busy = true;
    }
    renderer.render(scene, camera);
    if (!busy && !drag) running = false;   // idle: stop until something moves
    if (!running) lastT = 0;
  }
  function wake() { if (!running && visible) { running = true; requestAnimationFrame(frame); } }

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) { measure(); wake(); } }, { rootMargin: '200px 0px' });
  io.observe(root);
  addEventListener('resize', () => { measure(); wake(); });

  function push(dx) {
    target += dx;
    const lim = W;                           // never run more than a screen ahead
    target = current + Math.tanh((target - current) / lim) * lim;
    wake();
  }

  // ── Hit testing (flat rects; the bend is small near the middle) ────
  function cardAt(clientX, clientY) {
    const r = root.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top, top = (H - cardH) / 2;
    if (y < top || y > top + cardH) return -1;
    for (let k = 0; k < cards.length; k++) {
      const l = wrappedLeft(cards[k]);
      if (x >= l && x <= l + cards[k].w) return k;
    }
    return -1;
  }

  // ── Input ──────────────────────────────────────────────────────────
  root.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    drag = { x: e.clientX, y: e.clientY, last: e.clientX, lastT: performance.now(), d: 0, moved: false, id: e.pointerId };
  });
  addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 10 && Math.abs(dx) > Math.abs(dy)) {
        drag.moved = true; root.classList.add('is-dragging');
        try { root.setPointerCapture(drag.id); } catch (err) {}
      }
      if (drag.moved) {
        drag.d = (drag.last - e.clientX) * CONFIG.dragFactor; drag.last = e.clientX; drag.lastT = performance.now();
        push(drag.d);
      }
      return;
    }
    if (!finePointer || !root.contains(e.target)) return;
    const h = cardAt(e.clientX, e.clientY);
    if (h !== hover) { hover = h; wake(); }
    showPill(h >= 0 ? 'View' : 'Drag');
  });
  const end = () => {
    if (!drag) return;
    if (drag.moved && performance.now() - drag.lastT < 100) push(drag.d * CONFIG.flick);   // flick
    justDragged = drag.moved;
    drag = null; root.classList.remove('is-dragging');
    setTimeout(() => { justDragged = false; }, 0);
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  root.addEventListener('pointerleave', () => { hover = -1; wake(); showPill(null); });
  root.addEventListener('click', e => {
    if (justDragged) return;
    const k = cardAt(e.clientX, e.clientY);
    if (k < 0) return;
    const c = cards[k], r = root.getBoundingClientRect();
    onLightbox(sources, c.i, { left: r.left + wrappedLeft(c), top: r.top + (H - cardH) / 2, width: c.w, height: cardH });
  });
  // horizontal trackpad swipes move the ribbon; vertical scrolling passes to the page
  root.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    push(e.deltaX * (e.deltaMode === 1 ? 16 : 1) * CONFIG.wheelFactor);
  }, { passive: false });
  root.setAttribute('data-lenis-prevent-touch', '');
  list.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) onLightbox(sources, Number(b.dataset.i), null); });

  return { setSources, measure: () => { measure(); wake(); } };
}

// ── Lightbox ─────────────────────────────────────────────────────────
export function createLightbox({ onOpen, onClose }) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Photo');
  el.setAttribute('data-lenis-prevent', '');
  el.innerHTML = `
    <img class="lightbox__img" alt="">
    <button class="lightbox__btn lightbox__close" type="button" aria-label="Close">✕</button>
    <button class="lightbox__btn lightbox__prev" type="button" aria-label="Previous photo">←</button>
    <button class="lightbox__btn lightbox__next" type="button" aria-label="Next photo">→</button>
    <p class="lightbox__count label" aria-live="polite"></p>`;
  document.body.appendChild(el);
  const img = el.querySelector('.lightbox__img'), count = el.querySelector('.lightbox__count');
  let srcs = [], i = 0, lastFocus = null;

  function fitRect(w, h) {
    const maxW = innerWidth * 0.9, maxH = innerHeight * 0.82;
    const s = Math.min(maxW / w, maxH / h);
    return { width: w * s, height: h * s, left: (innerWidth - w * s) / 2, top: (innerHeight - h * s) / 2 };
  }
  function place(from) {
    const w = img.naturalWidth || 16, h = img.naturalHeight || 10;
    const r = fitRect(w, h);
    Object.assign(img.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    if (from && !reduce) {
      // grow out of the card that was clicked
      img.style.transition = 'none';
      img.style.transform = `translate(${from.left - r.left}px, ${from.top - r.top}px) scale(${from.width / r.width}, ${from.height / r.height})`;
      img.style.transformOrigin = '0 0';
      void img.offsetWidth;
      img.style.transition = '';
      img.style.transform = 'none';
    } else {
      img.style.transform = 'none';
    }
  }
  function show(k, from) {
    i = (k + srcs.length) % srcs.length;
    img.onload = () => place(from);
    img.src = srcs[i];
    if (img.complete && img.naturalWidth) place(from);
    count.textContent = `${String(i + 1).padStart(2, '0')} / ${String(srcs.length).padStart(2, '0')}`;
    el.classList.toggle('is-single', srcs.length < 2);
  }
  function open(list, k, from) {
    srcs = list; lastFocus = document.activeElement;
    el.classList.add('is-open');
    document.documentElement.classList.add('lightbox-open');
    show(k, from);
    onOpen?.();
    el.querySelector('.lightbox__close').focus({ preventScroll: true });
  }
  function close() {
    el.classList.remove('is-open');
    document.documentElement.classList.remove('lightbox-open');
    onClose?.();
    lastFocus?.focus?.({ preventScroll: true });
  }
  el.querySelector('.lightbox__close').addEventListener('click', close);
  el.querySelector('.lightbox__prev').addEventListener('click', () => show(i - 1));
  el.querySelector('.lightbox__next').addEventListener('click', () => show(i + 1));
  el.addEventListener('click', e => { if (e.target === el) close(); });
  addEventListener('keydown', e => {
    if (!el.classList.contains('is-open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(i - 1);
    else if (e.key === 'ArrowRight') show(i + 1);
  });
  // swipe on phones
  let sx = null;
  el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1)); sx = null; });
  addEventListener('resize', () => { if (el.classList.contains('is-open')) place(null); });
  return { open, close };
}
