// Mouse trail: halftone dots in two riso inks, printed slightly out of
// register. The dots shrink away like a halftone fading to paper.
// Only on devices with a mouse, and not when reduced motion is on.

const CONFIG = {
  spacing: 13,         // px between dots along the path
  size: 2.4,           // dot radius in px
  sizeJitter: 0.35,    // ± fraction
  scatter: 1,          // px of random sideways wobble, so it reads as print, not a line
  life: 0.28,          // seconds a dot lasts (short tail)
  misregister: [1.2, 0.9],   // px offset of the second ink
  opacity: 0.7,
  maxDots: 40,
};

export function createTrail({ inks = ['#FF48B0', '#0078BF'] } = {}) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const api = { setInks() {}, setEnabled() {} };
  if (reduce || !fine) return api;

  const canvas = document.createElement('canvas');
  canvas.className = 'ink-trail';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: '55', mixBlendMode: 'multiply',
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let dpr = 1, dots = [], last = null, running = false, enabled = true, ink = inks.slice(0, 2);

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  }
  addEventListener('resize', resize); resize();

  addEventListener('pointermove', e => {
    if (!enabled || e.pointerType !== 'mouse') { last = null; return; }
    const p = { x: e.clientX, y: e.clientY };
    if (!last) { last = p; return; }
    const dx = p.x - last.x, dy = p.y - last.y, dist = Math.hypot(dx, dy);
    if (dist < CONFIG.spacing) return;
    const n = Math.min(12, Math.floor(dist / CONFIG.spacing));
    const now = performance.now() / 1000;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      dots.push({
        x: last.x + dx * t + (Math.random() * 2 - 1) * CONFIG.scatter,
        y: last.y + dy * t + (Math.random() * 2 - 1) * CONFIG.scatter,
        born: now - (1 - t) * 0.016,
        r: CONFIG.size * (1 + (Math.random() * 2 - 1) * CONFIG.sizeJitter),
      });
    }
    if (dots.length > CONFIG.maxDots) dots.splice(0, dots.length - CONFIG.maxDots);
    last = p;
    if (!running) { running = true; requestAnimationFrame(draw); }
  }, { passive: true });
  document.addEventListener('pointerleave', () => { last = null; });

  function draw() {
    const now = performance.now() / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = CONFIG.opacity;
    dots = dots.filter(d => now - d.born < CONFIG.life);
    const [mx, my] = CONFIG.misregister;
    // second ink first, offset, then the first ink on top; multiply makes the overlap a third colour
    for (let pass = 1; pass >= 0; pass--) {
      ctx.fillStyle = ink[pass] || ink[0];
      ctx.beginPath();
      for (const d of dots) {
        const age = (now - d.born) / CONFIG.life;
        const r = d.r * Math.pow(1 - age, 0.9) * (pass ? 0.85 : 1) * dpr;
        if (r < 0.3) continue;
        const x = (d.x + (pass ? mx : 0)) * dpr, y = (d.y + (pass ? my : 0)) * dpr;
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    if (dots.length) requestAnimationFrame(draw); else running = false;
  }

  api.setInks = next => { if (next && next.length) ink = next.slice(0, 2); };
  api.setEnabled = on => { enabled = on; if (!on) { dots = []; last = null; ctx.clearRect(0, 0, canvas.width, canvas.height); } };
  return api;
}
