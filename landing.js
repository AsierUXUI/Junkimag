// Landing: Jonas's drawing, alive. Full-screen WebGL2: the drawing breathes and
// flows; the pointer is a "third eye" lens that splits the linework into riso
// layers; scrolling dives into the eye. The brush logo boils on top.
// Used by the single-page site (index.html) as the Home view.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createLanding({ root, jump = y => scrollTo(0, y), onScrolledIn = () => {}, onSection = () => {} }) {
  const canvas = root.querySelector('#eye');
  const inks = root.querySelectorAll('.mark__ink');
  const track = document.getElementById('landing-track');
  let active = false, progress = 0, boilTimer = 0, rafId = 0, morph = 0, morphAnim = null;
  // scroll: the first half dives into the eye, the second half closes the paper in around the hill
  const DIVE_END = 0.45, HILL_END = 0.97;
  let dive = 0, scrollMorph = 0, handedOff = false;
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true });
  if (!gl) root.classList.add('no-gl');

  // ── Logo boil: two inks jittering at 10 fps ─────────────────────────
  function boil() {
    inks.forEach((el, i) => {
      const k = i ? 1 : 1.6;
      el.style.setProperty('--jx', ((Math.random() * 2 - 1) * 1.6 * k + (i ? 0 : 4)).toFixed(2) + 'px');
      el.style.setProperty('--jy', ((Math.random() * 2 - 1) * 1.6 * k + (i ? 0 : 3)).toFixed(2) + 'px');
      el.style.setProperty('--jr', ((Math.random() * 2 - 1) * 0.5).toFixed(2) + 'deg');
    });
  }
  if (reduce) inks[0].style.setProperty('--jx', '4px');

  // ── Scroll: dive into the eye (over the landing track) ──────────────
  function onScroll() {
    if (!active || morphAnim) return;   // frozen while morphing into / out of the hill
    const max = Math.max(1, track.offsetHeight - innerHeight);
    progress = Math.min(1, Math.max(0, scrollY / max));
    dive = Math.min(1, progress / DIVE_END);
    scrollMorph = Math.min(1, Math.max(0, (progress - DIVE_END) / (HILL_END - DIVE_END)));
    document.documentElement.style.setProperty('--hill', scrollMorph.toFixed(3));
    root.style.setProperty('--p', dive.toFixed(3));
    root.style.setProperty('--mark-s', (1 + dive * 1.6).toFixed(3));
    root.style.setProperty('--mark-o', Math.max(0, 1 - dive * 2.2).toFixed(3));
    // the nav follows: once the hill is taking shape, we're in the zines
    onSection(scrollMorph > 0.35 ? 'zines' : 'landing');
    // scrolled all the way: the hill is formed, hand over to the zines
    if (progress >= 0.985 && !handedOff) { handedOff = true; onScrolledIn(); }
    if (progress < 0.97) handedOff = false;
  }
  addEventListener('scroll', onScroll, { passive: true });

  // ── The drawing (WebGL2) ────────────────────────────────────────────
  let draw = () => {};
  if (gl) {
  const VS = `#version 300 es
    in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;
    const FS = `#version 300 es
    precision highp float;
    uniform sampler2D uTex;
    uniform vec2 uRes;      // drawing buffer px
    uniform float uTime, uTile, uR, uZoom, uDpr;
    uniform vec2 uLens;     // lens centre, in "p" units (height = 1, origin centre)
    // morph into the carousel's lime hill (0 = landing, 1 = exactly the hill)
    uniform float uMorph;
    uniform vec4 uHill;     // the hill's SVG box in device px from the top-left: x, y, w, h
    uniform float uFill;    // 1 on phones: the hill continues as a solid block below
    uniform vec2 uPoly[32]; // the hill outline, in SVG units (1030 × 440)
    uniform float uReach;   // device px from the hill to the farthest screen corner
    out vec4 o;
    const vec3 PAPER = vec3(0.949, 0.941, 0.922);
    const vec3 INK   = vec3(0.067);
    const vec3 PINK  = vec3(1.0, 0.282, 0.690);
    const vec3 BLUE  = vec3(0.0, 0.471, 0.749);
    const vec3 LIME  = vec3(0.651, 0.910, 0.122);

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

    // signed distance to the hill outline (negative inside), in SVG units
    float sdPoly(vec2 p) {
      float d = dot(p - uPoly[0], p - uPoly[0]), s = 1.0;
      for (int i = 0, j = 31; i < 32; j = i, i++) {
        vec2 e = uPoly[j] - uPoly[i], w = p - uPoly[i];
        vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
        d = min(d, dot(b, b));
        bvec3 c = bvec3(p.y >= uPoly[i].y, p.y < uPoly[j].y, e.x * w.y > e.y * w.x);
        if (all(c) || all(not(c))) s *= -1.0;
      }
      return s * sqrt(d);
    }

    // ink coverage of the drawing at point p (in "p" units), tiled
    float ink(vec2 p) { return texture(uTex, p * uTile + 0.5).a; }

    void main() {
      vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
      // dive: zoom toward the lens
      vec2 q = uLens + (p - uLens) / uZoom;
      // breathing + slow liquid flow
      float t = uTime;
      vec2 warp = vec2(fbm(q * 1.6 + vec2(t * 0.05, 0.0)), fbm(q * 1.6 + vec2(7.3, -t * 0.04))) - 0.5;
      q += warp * 0.035;
      q *= 1.0 + sin(t * 0.35) * 0.012;

      // the third-eye lens
      float d = length(p - uLens);
      float r = uR;
      float inside = 1.0 - smoothstep(r * 0.9, r, d);
      // magnify inside the lens (a soft bulge)
      vec2 ql = uLens + (q - uLens) * mix(0.62, 1.0, smoothstep(0.0, r, d));

      // outside: black linework on paper
      float a0 = ink(q);
      vec3 col = mix(PAPER, INK, a0 * 0.78);

      // inside: the same lines split into riso layers, slightly out of register
      float wob = sin(t * 1.3) * 0.0025;
      float aP = ink(ql + vec2(0.0045 + wob, 0.0015));
      float aB = ink(ql + vec2(-0.0035, -0.003 - wob));
      float aL = ink(ql);
      vec3 riso = PAPER;
      // lime halftone wash, dots bigger toward the centre
      vec2 cell = gl_FragCoord.xy / (6.0 * uDpr);
      float dotR = 0.55 * (1.0 - smoothstep(0.0, r, d)) + 0.12;
      float dots = 1.0 - smoothstep(dotR - 0.08, dotR, length(fract(cell) - 0.5));
      riso = mix(riso, riso * LIME, dots * 0.55);
      riso *= mix(vec3(1.0), BLUE, aB * 0.85);
      riso *= mix(vec3(1.0), PINK, aP * 0.9);
      riso = mix(riso, INK, aL * 0.25);
      col = mix(col, riso, inside);

      // a hand-drawn ring around the eye
      float ang = atan(p.y - uLens.y, p.x - uLens.x);
      float rr = r * (1.0 + (noise(vec2(ang * 3.0, floor(t * 10.0))) - 0.5) * 0.03);
      float ring = 1.0 - smoothstep(0.0012, 0.0032, abs(d - rr));
      col = mix(col, INK, ring * 0.9 * (1.0 - smoothstep(0.6, 1.0, r)));

      float alpha = 1.0;
      if (uMorph > 0.0) {
        // where this pixel sits in the hill's SVG
        vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
        vec2 sv = (css - uHill.xy) / uHill.zw * vec2(1030.0, 440.0);
        float dh = sdPoly(sv) * uHill.z / 1030.0;   // device px, negative inside the hill
        if (uFill > 0.5 && sv.y > 400.0 && sv.x >= 0.0 && sv.x <= 1030.0) dh = min(dh, -2.0);
        float e = smoothstep(0.0, 1.0, uMorph);
        // the paper closes in from the edges: everything within 'reach' of the hill is still the eye
        float reach = pow(1.0 - uMorph, 1.25) * uReach;
        float edge = dh - reach + (noise(vec2(atan(sv.y - 300.0, sv.x - 515.0) * 5.0, floor(t * 10.0))) - 0.5) * 6.0 * uDpr * (1.0 - e);
        float inHill = 1.0 - smoothstep(-1.0, 1.0, edge);
        // the drawing slides and shrinks from the landing's mapping to the hill's own
        vec2 uvL = q * uTile + 0.5;
        vec2 uvH = vec2(sv.x / 1030.0, (sv.y + 90.0) / 1030.0);
        float aH = texture(uTex, mix(uvL, uvH, e)).a;
        float g = clamp(((sv.x / 1030.0) * 0.35 + (sv.y - 22.0) / 418.0) / 1.1225, 0.0, 1.0);
        vec3 lime = sv.y > 440.0 ? vec3(0.557, 0.878, 0.0) : mix(vec3(0.894, 1.0, 0.361), vec3(0.557, 0.878, 0.0), g);
        vec3 hillCol = mix(lime, INK, aH * mix(0.78, 0.13, e));
        vec3 inCol = mix(col, hillCol, smoothstep(0.3, 0.9, uMorph));
        col = mix(PAPER, inCol, inHill);
        // a hand-drawn outline riding the closing edge
        float line = 1.0 - smoothstep(1.0 * uDpr, 2.6 * uDpr, abs(edge));
        col = mix(col, INK, line * 0.85 * (1.0 - smoothstep(0.75, 1.0, uMorph)));
        // at the end, everything outside the hill turns see-through so the zines show
        alpha = mix(1.0, max(inHill, line * (1.0 - smoothstep(0.75, 1.0, uMorph))), smoothstep(0.5, 1.0, uMorph));
        // last stretch: hand over to the real hill (same place, same lime) underneath
        alpha *= 1.0 - smoothstep(0.82, 1.0, uMorph);
      }

      // paper grain
      col *= 0.96 + 0.04 * hash(gl_FragCoord.xy + floor(t * 12.0));
      o = vec4(col * alpha, alpha);
    }`;

    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(prog, n);
    const u = { tex: U('uTex'), res: U('uRes'), time: U('uTime'), tile: U('uTile'), r: U('uR'), zoom: U('uZoom'), lens: U('uLens'), dpr: U('uDpr'),
      morph: U('uMorph'), reach: U('uReach'), hill: U('uHill'), fill: U('uFill'), poly: U('uPoly') };

    // the carousel's hill: its outline (sampled once from the SVG path) and where it sits now
    const shapeSvg = document.getElementById('shape');
    const shapePath = shapeSvg && shapeSvg.querySelector('path[fill]');
    const shapeFill = document.querySelector('.shape-layer__fill');
    const poly = new Float32Array(64);
    if (shapePath) {
      const len = shapePath.getTotalLength();
      for (let i = 0; i < 32; i++) { const pt = shapePath.getPointAtLength(len * i / 32); poly[i * 2] = pt.x; poly[i * 2 + 1] = pt.y; }
    }

    // the drawing as a repeating texture
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    };
    img.src = 'img/jonas-drawing.webp';

    let dpr = 1;
    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    addEventListener('resize', resize); resize();

    // lens follows the pointer / finger; wanders on its own when left alone
    const toP = (x, y) => [(x - innerWidth / 2) / innerHeight, -(y - innerHeight / 2) / innerHeight];
    let target = [0.18, -0.12], lens = target.slice(), lastMove = -1e9;
    const follow = e => { if (!active) return; const pt = e.touches ? e.touches[0] : e; target = toP(pt.clientX, pt.clientY); lastMove = performance.now(); };
    addEventListener('pointermove', follow, { passive: true });
    addEventListener('touchmove', follow, { passive: true });
    addEventListener('touchstart', follow, { passive: true });

    const t0 = performance.now();
    draw = now => {
      const t = (now - t0) / 1000;
      const aspect = innerWidth / innerHeight;
      if (now - lastMove > 2500 && !reduce) target = [Math.sin(t * 0.23) * 0.32 * aspect, Math.sin(t * 0.37) * 0.22 - 0.05];
      const k = reduce ? 1 : 0.08;
      lens[0] += (target[0] - lens[0]) * k; lens[1] += (target[1] - lens[1]) * k;
      // morph animation toward / away from the hill
      if (morphAnim) {
        const k2 = Math.min(1, (now - morphAnim.start) / (morphAnim.dur * 1000));
        morph = morphAnim.from + (morphAnim.to - morphAnim.from) * (k2 < 0.5 ? 4 * k2 * k2 * k2 : 1 - Math.pow(-2 * k2 + 2, 3) / 2);
        if (k2 >= 1) { const done = morphAnim.done; morphAnim = null; done && done(); }
      }
      const m = Math.max(morph, scrollMorph);
      const ease = dive * dive;
      const baseR = (aspect < 0.8 ? 0.2 : 0.17);
      gl.uniform1i(u.tex, 0);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, reduce ? 0 : t);
      gl.uniform1f(u.tile, 0.55);
      gl.uniform1f(u.r, baseR + ease * 1.4);
      gl.uniform1f(u.zoom, 1 + ease * 3);
      gl.uniform2f(u.lens, lens[0] * (1 - ease), lens[1] * (1 - ease));
      gl.uniform1f(u.dpr, dpr);
      gl.uniform1f(u.morph, m);
      const hin = Math.min(1, Math.max(0, (m - 0.62) / 0.3));
      document.documentElement.style.setProperty('--hill-in', (hin * hin * (3 - 2 * hin)).toFixed(3));
      if (m > 0 && shapeSvg) {
        const r = shapeSvg.getBoundingClientRect();
        gl.uniform4f(u.hill, r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr);
        // farthest screen corner from the hill's box (its ridge starts ~12% down the box)
        const k = Math.min(r.width / 1030, r.height / 440), bx0 = r.left + (r.width - 1030 * k) / 2, bx1 = bx0 + 1030 * k, by0 = r.top + 52 * k, by1 = r.top + 440 * k;
        let far = 0;
        for (const [cx, cy] of [[0, 0], [innerWidth, 0], [0, innerHeight], [innerWidth, innerHeight]])
          far = Math.max(far, Math.hypot(Math.max(bx0 - cx, 0, cx - bx1), Math.max(by0 - cy, 0, cy - by1)));
        gl.uniform1f(u.reach, (far + 12) * dpr);
        gl.uniform1f(u.fill, shapeFill && getComputedStyle(shapeFill).display !== 'none' ? 1 : 0);
        gl.uniform2fv(u.poly, poly);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  }

  function loop(now) { if (!active) return; rafId = requestAnimationFrame(loop); draw(now); }

  function animateMorph(to, dur, done) {
    morphAnim = { from: morph, to, start: performance.now(), dur: reduce || !gl ? 0.001 : dur, done };
    root.classList.add('is-morph');
  }

  return {
    // fromHill: arrive by growing out of the carousel's hill
    // atEnd: scrolled back up from the zines — start at the bottom of the scroll, hill formed, and let scrolling undo it
    show({ fromHill = false, atEnd = false } = {}) {
      if (active && !fromHill) return;
      const wasActive = active;
      active = true;
      // arriving from the hill: hide the words at once (no fade-out flash), then fade them in at the end
      if (fromHill && !atEnd) { root.classList.add('is-morph', 'is-snap'); void root.offsetWidth; root.classList.remove('is-snap'); }
      root.classList.add('is-on');
      progress = 0; dive = 0; scrollMorph = 0; handedOff = false;
      document.documentElement.style.setProperty('--hill', '0');
      document.documentElement.style.setProperty('--hill-in', fromHill || atEnd ? '1' : '0');
      if (atEnd) {
        const max = Math.max(1, track.offsetHeight - innerHeight);
        jump(Math.round(max * 0.955));
        handedOff = true;
        onScroll();
      } else if (fromHill) {
        // come back up to the bottom of the dive (inside the eye), then the hill grows back out
        const max = Math.max(1, track.offsetHeight - innerHeight);
        jump(Math.round(max * DIVE_END * 0.96));
        progress = DIVE_END * 0.96; dive = 0.96;
        morph = 1;
        animateMorph(0, 0.95, () => { root.classList.remove('is-morph'); onScroll(); });
      } else onScroll();
      if (!reduce && !boilTimer) boilTimer = setInterval(boil, 100);
      if (!wasActive) rafId = requestAnimationFrame(loop);
    },
    // shrink into the carousel's hill, then step away
    leaveIntoHill(done) {
      if (!active) { done && done(); return; }
      morph = Math.max(morph, scrollMorph);   // already partly (or fully) formed by scrolling
      animateMorph(1, 0.95 * (1 - morph) + 0.05, () => { this.hide(); done && done(); });
    },
    hide() {
      active = false; morph = 0; morphAnim = null; scrollMorph = 0;
      document.documentElement.style.setProperty('--hill', '0');
      const snap = root.classList.contains('is-morph');   // ending a morph: vanish at once, don't fade back on top
      if (snap) root.classList.add('is-snap');
      root.classList.remove('is-on', 'is-morph');
      if (snap) { void root.offsetWidth; root.classList.remove('is-snap'); }
      clearInterval(boilTimer); boilTimer = 0; cancelAnimationFrame(rafId);
    },
    refresh() { onScroll(); },
    get active() { return active; },
  };
}
