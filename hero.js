// Junki hero: a diagonal row of 3D zines.
// Scroll steps one zine at a time, drag flips a zine to its back cover,
// a hand-drawn scribble circles the zine in front.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { makeCover, waitForFonts } from './covers.js';
import { createZineKit } from './zine-mesh.js';
import { createWheelStepper } from './wheel-steps.js';

// Every tunable value lives here. Add ?debug to the URL for a live panel.
const CONFIG = {
  // scene & camera
  cameraFOV: 40, cameraDistance: 4.4, galleryScale: 1.08,
  galleryRotX: -30, galleryRotY: -30, itemYaw: 18, itemPitch: 12,
  exposure: 0.86, environmentIntensity: 0.55,
  hGap: 1.85, depthGap: 1, depthK: 0.18,
  activeY: 0.06, inactiveScale: 0.8, renderRadius: 5,
  // lights
  keyIntensity: 0.75, keyX: 3.5, keyY: 8, fillIntensity: 0.3, rimIntensity: 0.75, topStripIntensity: 1.9,
  // zine
  zineHeight: 2.0, zineThickness: 0.012,
  // snap spring
  snapFreq: 9.5, snapDamping: 12,
  // flow while moving
  flowLean: 0.055, flowLeanMax: 0.3, flowBank: 0.032, flowBankMax: 0.3, flowDip: 0.014, flowDipMax: 0.09,
  followTight: 15, followBase: 11, followFalloff: 1.15, followMin: 6.5,
  // wipe
  wipePush: 0.012, wipePushMax: 0.5, wipeSpin: 0.009, wipeSpinMax: 0.4, wipeMinSpeed: 9, pushReturn: 3.4,
  // hover / press / drag
  hoverTiltStrength: 0.21,
  dragStartDistance: 5, dragSensitivity: 0.95, dragVelocitySmoothing: 0.32, dragMaxVelocity: 0.5,
  friction: 0.89, maxSpinAngle: 180, resetRate: 4, pressDepth: 0.55, pressTilt: 1.5,
  // wheel classifier
  wheelNoiseFloor: 0.3, wheelStepThreshold: 6, wheelEventCap: 24, wheelEnvelopeTau: 550,
  wheelRiseFactor: 1.2, wheelTickGap: 34, wheelPauseGap: 130, wheelIdleReset: 150,
  wheelMinStepTick: 90, wheelMinStepFlick: 190, wheelSustainDelay: 480, wheelSustainRatio: 0.8,
  // touch
  touchFlickVelocity: 0.35, touchLeadMaxHeight: 0.6,
  // intro
  preloadSpin: 1.1, preloadRiseFrom: 3, preloadRiseDepth: 0.7, preloadFanDuration: 1.15, preloadStagger: 0.07,
  // leaving for the catalog
  flightRecede: 2.2, flightStagger: 0.45, flightPopScale: 0.35,
  // scribble
  scribbleEnabled: 1, scribbleFps: 10, scribblePoints: 24, scribbleJitter: 0.028, scribbleLoops: 2,
  scribbleLoopGap: 0.045, scribblePadding: 0.06, scribbleWidth: 0.012, scribbleSweep: 0.68,
  scribbleSweepJitter: 0.4, scribbleDrawTime: 0.5,
  // back layer
  badgePerItem: 14, shapeSway: 0.8,
};

const ZINES = window.JUNKI_ZINES || [];
const N = ZINES.length;
// Longest frame step in seconds. Slow frames play in slow motion instead of jumping.
// (?maxdt=0.25 lets automated screenshots on software rendering run at real speed.)
const MAX_DT = Number(new URLSearchParams(location.search).get('maxdt')) || 1 / 30;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(hover: none)').matches;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const easeExpoOut = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeCubicOut = t => 1 - Math.pow(1 - t, 3);
const easeCubicInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easePow2Out = t => 1 - (1 - t) * (1 - t);

const $ = id => document.getElementById(id);
const hero = $('hero'), glCanvas = $('gl'), scribbleCanvas = $('scribble');
const metaEl = $('meta'), notesEl = $('notes'), liveEl = $('live');
const pill = $('cursor-pill'), pillText = $('cursor-pill-text');
const badgeEl = $('badge'), shapeEl = $('shape');
const preloader = $('preloader'), preloaderCount = $('preloader-count');

const detailUrl = z => 'zine.html?zine=' + encodeURIComponent(z.slug);

// ── Renderer ─────────────────────────────────────────────────────────
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  renderer = null;
}
if (!renderer || !N) {
  startFallback();
} else {
  init();
}

function startFallback() {
  document.documentElement.classList.add('no-webgl');
  const fb = $('fallback');
  ZINES.forEach(async z => {
    const a = document.createElement('a'); a.href = detailUrl(z); a.setAttribute('aria-label', z.title);
    fb.appendChild(a);
    const c = await makeCover(z, 'front'); const img = new Image(); img.alt = z.title; img.src = c.toDataURL('image/jpeg', 0.85); a.appendChild(img);
  });
  renderMeta(0, false);
  document.documentElement.removeAttribute('data-preload');
  preloader.classList.add('is-done');
  hero.classList.add('is-ready');
}

function init() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(CONFIG.cameraFOV, 1, 0.1, 100);
  camera.position.set(0, 0, CONFIG.cameraDistance);

  // lights
  RectAreaLightUniformsLib.init();
  const key = new THREE.DirectionalLight(0xffffff, CONFIG.keyIntensity);
  key.position.set(CONFIG.keyX, CONFIG.keyY, 6);
  const fill = new THREE.DirectionalLight(0xfff4ea, CONFIG.fillIntensity);
  fill.position.set(-5, -2, 4);
  const rim = new THREE.DirectionalLight(0xffffff, CONFIG.rimIntensity);
  rim.position.set(-2, 4, -6);
  const strip = new THREE.RectAreaLight(0xffffff, CONFIG.topStripIntensity, 9, 0.35);
  strip.position.set(0, 2.6, 2.2);
  strip.lookAt(0, 0, 0);
  scene.add(key, fill, rim, strip);

  const gallery = new THREE.Group();
  scene.add(gallery);

  // ── Zine meshes ────────────────────────────────────────────────────
  const kit = createZineKit(renderer, { height: CONFIG.zineHeight, thickness: CONFIG.zineThickness, envIntensity: CONFIG.environmentIntensity });
  const { ZW, ZH, ZT } = kit;

  const items = ZINES.map((zine, i) => {
    const z = kit.build(zine);
    z.mesh.userData.index = i;
    const group = new THREE.Group(); group.add(z.inner); group.visible = false;
    gallery.add(group);
    return {
      ...z, i, zine, group,
      px: i * CONFIG.hGap, py: 0, pz: 0, ps: CONFIG.inactiveScale,
      push: 0, pushSpin: 0,
      spin: 0, spinVel: 0,
      tiltX: 0, tiltY: 0, press: 0, pressX: 0, pressY: 0,
    };
  });

  async function loadTextures(item) {
    await kit.loadTextures(item, item.zine);
    dirty = true;
  }

  // ── State ──────────────────────────────────────────────────────────
  const startIndex = 0;
  let x = startIndex, v = 0, target = startIndex;   // spring on the float index
  let dirty = true, lastT = performance.now(), clock = 0;
  let introStart = -1, introDone = reduce;
  let flight = null;
  let hovered = null, pointer = { x: -1e4, y: -1e4, ndc: new THREE.Vector2(), inside: false };
  let layout = { rotX: CONFIG.galleryRotX, rotY: CONFIG.galleryRotY, scale: CONFIG.galleryScale, gap: CONFIG.hGap, narrow: false };
  const raycaster = new THREE.Raycaster();

  function goTo(i, { fromUser = true } = {}) {
    const t = clamp(Math.round(i), 0, N - 1);
    if (t === target) return;
    target = t;
    if (reduce) { x = t; v = 0; }
    startScribble(t);
    dirty = true;
    if (fromUser) hero.focus({ preventScroll: true });
  }
  const step = dir => goTo(target + dir);

  // ── Layout / resize ────────────────────────────────────────────────
  function resize() {
    const w = hero.clientWidth, h = hero.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const dpr = Math.min(devicePixelRatio, 2);
    scribbleCanvas.width = Math.round(w * dpr); scribbleCanvas.height = Math.round(h * dpr);
    const visH = 2 * CONFIG.cameraDistance * Math.tan(CONFIG.cameraFOV * DEG / 2);
    const visW = visH * camera.aspect;
    const narrow = camera.aspect < 0.9;
    if (narrow) {
      const s = Math.min(CONFIG.touchLeadMaxHeight * visH / ZH, 0.62 * visW / ZW);
      layout = { rotX: -14, rotY: -16, scale: s, gap: ZW * 1.08, narrow };
    } else {
      const s = Math.min(CONFIG.galleryScale, 0.68 * visH / ZH);
      layout = { rotX: CONFIG.galleryRotX, rotY: CONFIG.galleryRotY, scale: s, gap: CONFIG.hGap, narrow };
    }
    gallery.rotation.set(layout.rotX * DEG, layout.rotY * DEG, 0);
    gallery.scale.setScalar(layout.scale);
    dirty = true;
  }
  addEventListener('resize', resize);
  resize();

  // ── Frame ──────────────────────────────────────────────────────────
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - lastT) / 1000; lastT = now;
    dt = Math.min(dt, MAX_DT);
    clock += dt;

    // spring on the index (semi-implicit Euler, two sub-steps for stability)
    const prevX = x;
    if (!reduce) {
      const subs = Math.max(2, Math.ceil(dt * 120));
      for (let k = 0; k < subs; k++) {
        const h = dt / subs;
        v += (-(CONFIG.snapFreq ** 2) * (x - target) - CONFIG.snapDamping * v) * h;
        x += v * h;
      }
      if (Math.abs(x - target) < 1e-4 && Math.abs(v) < 1e-3) { x = target; v = 0; }
    } else {
      x = target; v = 0;
    }
    if (swipe) { x = swipe.live; v = swipe.vel; }

    let motion = Math.abs(x - prevX);
    const speed = Math.abs(v);
    const tIntro = introStart < 0 ? -1 : clock - introStart;
    if (tIntro >= 0 && !introDone && tIntro > 0.6 + CONFIG.preloadFanDuration + CONFIG.preloadStagger * 6) introDone = true;

    for (const it of items) {
      const d = it.i - x, ad = Math.abs(d);
      const inRange = ad <= CONFIG.renderRadius + 0.5;
      it.group.visible = inRange && (introStart >= 0 || reduce);
      if (!inRange) continue;
      if (!it.loaded) loadTextures(it);

      // slot on the diagonal
      const near = Math.min(ad, 1);
      const sx = d * layout.gap;
      const sz = -ad * CONFIG.depthGap * CONFIG.depthK;
      const sy = CONFIG.activeY * (1 - near);
      const ss = lerp(1, CONFIG.inactiveScale, near);

      // follow-through: the zine in front follows tightly, the far ones lag like a loose chain
      const dist = Math.abs(it.i - target);
      const rate = dist < 0.5 ? CONFIG.followTight : Math.max(CONFIG.followMin, CONFIG.followBase * Math.pow(CONFIG.followFalloff, -dist));
      const k = reduce ? 1 : damp(rate, dt);
      const before = it.px + it.py + it.pz + it.ps;
      it.px += (sx - it.px) * k; it.py += (sy - it.py) * k; it.pz += (sz - it.pz) * k; it.ps += (ss - it.ps) * k;

      // wipe: fast moves shove the zines passing the centre
      if (!reduce && speed > CONFIG.wipeMinSpeed && ad < 1) {
        it.push = Math.max(it.push, Math.min(speed * CONFIG.wipePush * 10, CONFIG.wipePushMax) * (1 - ad));
        it.pushSpin = Math.max(it.pushSpin, Math.min(speed * CONFIG.wipeSpin * 10, CONFIG.wipeSpinMax) * (1 - ad));
      }
      it.push += (0 - it.push) * damp(CONFIG.pushReturn, dt);
      it.pushSpin += (0 - it.pushSpin) * damp(CONFIG.pushReturn, dt);

      // flow: lean, bank and dip into the movement
      const lean = reduce ? 0 : clamp(v * CONFIG.flowLean, -CONFIG.flowLeanMax, CONFIG.flowLeanMax);
      const bank = reduce ? 0 : clamp(v * CONFIG.flowBank, -CONFIG.flowBankMax, CONFIG.flowBankMax);
      const dip = reduce ? 0 : Math.min(speed * CONFIG.flowDip, CONFIG.flowDipMax);

      // spin (drag to flip), inertia, then settle on the nearest face
      const isActive = it.i === target;
      if (drag && drag.item === it && drag.mode === 'spin') {
        // set by pointer
      } else {
        it.spin += it.spinVel * dt;
        it.spinVel *= Math.pow(CONFIG.friction, dt * 60);
        const lim = CONFIG.maxSpinAngle * DEG;
        if (Math.abs(it.spin) > lim) { it.spin = Math.sign(it.spin) * lim; it.spinVel = 0; }
        if (Math.abs(it.spinVel) < 1.2) {
          const face = isActive ? Math.round(it.spin / Math.PI) * Math.PI : 0;
          it.spin += (face - it.spin) * damp(isActive ? 6 : CONFIG.resetRate, dt);
          it.spinVel *= 0.9;
        }
      }

      // hover tilt and press
      const hTarget = hovered && hovered.item === it && !drag ? hovered : null;
      it.tiltX += ((hTarget ? hTarget.ly : 0) - it.tiltX) * damp(10, dt);
      it.tiltY += ((hTarget ? hTarget.lx : 0) - it.tiltY) * damp(10, dt);
      const pressed = drag && drag.item === it && drag.mode !== 'swipe' ? 1 : 0;
      it.press += (pressed - it.press) * damp(14, dt);

      // intro choreography: rise from below spinning, stack, then fan out
      let ix = it.px, iy = it.py - dip, iz = it.pz - it.push, is = it.ps, extraSpin = it.pushSpin * Math.sign(v || 1);
      if (!introDone && tIntro >= 0) {
        const rank = Math.abs(it.i - target);
        const rise = easeCubicOut(clamp(tIntro / 0.7, 0, 1));
        const fan = easeExpoOut(clamp((tIntro - 0.55 - rank * CONFIG.preloadStagger) / CONFIG.preloadFanDuration, 0, 1));
        const stackX = rank * 0.02, stackY = lerp(-CONFIG.preloadRiseFrom, 0, rise), stackZ = -rank * 0.03 - (1 - rise) * CONFIG.preloadRiseDepth;
        ix = lerp(stackX, ix, fan); iy = lerp(stackY, iy, fan); iz = lerp(stackZ, iz, fan);
        is = lerp(CONFIG.inactiveScale * 0.9, is, fan);
        extraSpin += (1 - rise) * CONFIG.preloadSpin * Math.PI;
        motion += 1;
      } else if (tIntro < 0 && !reduce) {
        it.group.visible = false;
      }

      // leaving for the catalog
      if (flight) {
        const tf = clock - flight.start;
        if (it.i === flight.index) {
          is *= 1 + CONFIG.flightPopScale * easeCubicInOut(clamp(tf / 0.5, 0, 1));
        } else {
          const delay = Math.min(Math.abs(it.i - flight.index), 4) / 4 * CONFIG.flightStagger;
          iz -= CONFIG.flightRecede * easeCubicInOut(clamp((tf - delay * 0.4) / 0.5, 0, 1));
        }
        motion += 1;
      }

      it.group.position.set(ix, iy, iz);
      it.group.scale.setScalar(is);
      it.group.rotation.set(CONFIG.itemPitch * DEG - dip * 0.5, CONFIG.itemYaw * DEG - lean, -bank);
      it.inner.position.z = -it.press * CONFIG.pressDepth * 0.25;
      it.inner.rotation.set(
        -it.tiltX * CONFIG.hoverTiltStrength - it.press * it.pressY * CONFIG.pressTilt * 0.08,
        it.spin + extraSpin + it.tiltY * CONFIG.hoverTiltStrength + it.press * it.pressX * CONFIG.pressTilt * 0.08,
        0,
      );
      motion += Math.abs(it.px + it.py + it.pz + it.ps - before) + Math.abs(it.spinVel) * dt + Math.abs(it.push)
        + Math.abs(it.tiltX) * 0.01 + Math.abs(it.press) * 0.01;
      if (Math.abs(it.spin - Math.round(it.spin / Math.PI) * Math.PI) > 1e-3) motion += 1e-3;
    }

    // back layer follows the index
    badgeEl.style.setProperty('--badge-rot', (-x * CONFIG.badgePerItem).toFixed(3) + 'deg');
    shapeEl.style.setProperty('--shape-y', clamp(v * CONFIG.shapeSway * 3, -8, 8).toFixed(2) + 'px');

    // cursor pill eases after the pointer
    pillPos.x += (pointer.x - pillPos.x) * 0.25; pillPos.y += (pointer.y - pillPos.y) * 0.25;
    pill.style.setProperty('--x', pillPos.x.toFixed(1) + 'px'); pill.style.setProperty('--y', pillPos.y.toFixed(1) + 'px');

    if (motion > 1e-5 || dirty) {
      gallery.updateMatrixWorld(true);
      renderer.render(scene, camera);
      dirty = false;
      scribbleDirty = true;
    }
    drawScribble(motion > 1e-5);
    maybeSwapMeta();
  }
  const pillPos = { x: -100, y: -100 };

  // ── Scribble ───────────────────────────────────────────────────────
  const sctx = scribbleCanvas.getContext('2d');
  let scribble = null, oldScribble = null, scribbleDirty = true, lastJitterTick = -1;

  function startScribble(index) {
    if (!CONFIG.scribbleEnabled) return;
    if (scribble && scribble.index === index) return;
    oldScribble = scribble;
    const r = Math.random;
    scribble = {
      index, start: clock,
      a: r() * CONFIG.scribbleSweepJitter,
      len: CONFIG.scribbleSweep + (r() - 0.5) * CONFIG.scribbleSweepJitter * 0.25,
      seed: Math.floor(r() * 1e6), phase: r() * Math.PI * 2,
    };
    scribbleDirty = true;
  }

  function seeded(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
  const tmpV = new THREE.Vector3();

  function scribblePoints(s, item, tick) {
    const P = CONFIG.scribblePoints, L = CONFIG.scribbleLoops;
    const pts = [];
    const total = P * L;
    const w = scribbleCanvas.width, h = scribbleCanvas.height;
    const jit = reduce ? 0 : CONFIG.scribbleJitter;
    for (let k = 0; k <= total; k++) {
      const t = k / P * Math.PI * 2 + s.phase;
      const loopPad = CONFIG.scribblePadding + CONFIG.scribbleLoopGap * (k / P);
      const a = ZW / 2 + loopPad, b = ZH / 2 + loopPad;
      const c = Math.cos(t), sn = Math.sin(t);
      const ex = 0.5; // superellipse n = 4
      let lx = a * Math.sign(c) * Math.pow(Math.abs(c), ex);
      let ly = b * Math.sign(sn) * Math.pow(Math.abs(sn), ex);
      lx += (seeded(s.seed + k * 3.1 + tick * 17.7) * 2 - 1) * jit;
      ly += (seeded(s.seed + k * 5.7 + tick * 11.3) * 2 - 1) * jit;
      tmpV.set(lx, ly, ZT / 2 + 0.002);
      item.mesh.localToWorld(tmpV);
      tmpV.project(camera);
      pts.push([(tmpV.x * 0.5 + 0.5) * w, (-tmpV.y * 0.5 + 0.5) * h]);
    }
    return pts;
  }

  function catmull(pts, sub = 6) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let j = 0; j < sub; j++) {
        const t = j / sub, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function pxPerUnit(item) {
    item.mesh.getWorldPosition(tmpV);
    const depth = Math.abs(tmpV.z - camera.position.z);
    return scribbleCanvas.height / (2 * depth * Math.tan(CONFIG.cameraFOV * DEG / 2)) * layout.scale;
  }

  function strokeScribble(s, progress, tick) {
    const item = items[s.index];
    if (!item || !item.group.visible) return;
    const curve = catmull(scribblePoints(s, item, tick));
    // arc length
    const acc = [0];
    for (let i = 1; i < curve.length; i++) acc.push(acc[i - 1] + Math.hypot(curve[i][0] - curve[i - 1][0], curve[i][1] - curve[i - 1][1]));
    const total = acc[acc.length - 1];
    const from = s.a * (1 - s.len) * total, to = from + s.len * total * progress;
    const base = CONFIG.scribbleWidth * pxPerUnit(item) * item.ps;
    sctx.strokeStyle = '#000'; sctx.lineCap = 'round'; sctx.lineJoin = 'round';
    const span = Math.max(1, s.len * total);
    for (let i = 1; i < curve.length; i++) {
      if (acc[i] < from || acc[i - 1] > to) continue;
      const u = (acc[i] - from) / span;
      const taper = Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 0.45);
      sctx.lineWidth = Math.max(0.6, base * (0.35 + 0.65 * taper));
      sctx.beginPath(); sctx.moveTo(curve[i - 1][0], curve[i - 1][1]); sctx.lineTo(curve[i][0], curve[i][1]); sctx.stroke();
    }
  }

  function drawScribble(moving) {
    if (!introDone && introStart >= 0) {
      // first scribble waits for the fan-out to land
      const t = clock - introStart;
      if (t < 0.55 + CONFIG.preloadFanDuration * 0.6) { if (scribble) scribble.start = clock; }
    }
    const tick = reduce ? 0 : Math.floor(clock * CONFIG.scribbleFps);
    const progress = scribble ? (reduce ? 1 : easePow2Out(clamp((clock - scribble.start) / CONFIG.scribbleDrawTime, 0, 1))) : 0;
    if (oldScribble && (progress > 0.35 || clock - scribble.start > 0.3)) { oldScribble = null; scribbleDirty = true; }
    if (!moving && !scribbleDirty && tick === lastJitterTick && (progress >= 1 || !scribble)) return;
    lastJitterTick = tick; scribbleDirty = false;
    sctx.clearRect(0, 0, scribbleCanvas.width, scribbleCanvas.height);
    if (flight || introStart < 0) return;
    if (oldScribble) strokeScribble(oldScribble, 1, tick);
    if (scribble) strokeScribble(scribble, progress, tick);
  }

  // ── Meta block ─────────────────────────────────────────────────────
  let shownIndex = -1, swapping = false;
  function maybeSwapMeta() {
    if (swapping || shownIndex === target || introStart < 0) return;
    if (!introDone && clock - introStart < 0.9) return;
    if (Math.abs(x - target) < 0.15 && Math.abs(v) < 2.5) swapMeta(target);
  }
  function swapMeta(index) {
    swapping = true;
    const first = shownIndex < 0;
    const done = () => { shownIndex = index; swapping = false; announce(index); };
    if (first || reduce) { renderMeta(index, !reduce && first); done(); return; }
    metaEl.classList.add('is-out'); notesEl.classList.add('is-out');
    setTimeout(() => { renderMeta(index, true); done(); }, 360);
  }

  // ── Input: wheel ───────────────────────────────────────────────────
  const wheelSteps = createWheelStepper(CONFIG, dir => step(dir));
  addEventListener('wheel', e => {
    e.preventDefault();
    if (flight || !introDoneForInput()) return;
    const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    wheelSteps(raw, e.deltaMode, performance.now());
  }, { passive: false });

  function introDoneForInput() { return introStart >= 0 && (introDone || clock - introStart > 0.9); }

  // ── Input: keyboard ────────────────────────────────────────────────
  addEventListener('keydown', e => {
    if (flight || !introDoneForInput()) return;
    if (e.target.closest && e.target.closest('a, button') && e.key === 'Enter') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'Enter' && (e.target === hero || e.target === document.body)) { e.preventDefault(); open(target); }
  });

  // ── Input: pointer (hover, press, drag to flip, swipe) ─────────────
  let drag = null, swipe = null;
  function setPointer(e) {
    const r = hero.getBoundingClientRect();
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  function pick() {
    gallery.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer.ndc, camera);
    const meshes = items.filter(it => it.group.visible).map(it => it.mesh);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const item = items[hit.object.userData.index];
    const local = item.mesh.worldToLocal(hit.point.clone());
    return { item, lx: clamp(local.x / (ZW / 2), -1, 1), ly: clamp(local.y / (ZH / 2), -1, 1) };
  }
  function updateHover() {
    if (drag || flight || coarse) { setPill(null); return; }
    hovered = pick();
    hero.classList.toggle('is-hovering', !!hovered);
    setPill(hovered);
    dirty = true;
  }
  function setPill(h) {
    pill.classList.toggle('is-visible', !!h);
    if (h) pillText.textContent = h.item.i === target ? 'See this issue' : 'Bring to front';
  }

  hero.addEventListener('pointermove', e => {
    setPointer(e);
    if (!drag) { updateHover(); return; }
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    const now = performance.now();
    if (!drag.moved && Math.hypot(dx, dy) > CONFIG.dragStartDistance) {
      drag.moved = true;
      // a mouse drag on a zine flips it; anything else swipes the row
      drag.mode = (drag.item && e.pointerType !== 'touch' && !reduce) ? 'spin' : 'swipe';
      if (drag.mode === 'swipe') swipe = { start: x, live: x, vel: 0, lastX: e.clientX, lastT: now };
      hero.classList.add('is-grabbing');
      setPill(null);
    }
    if (!drag.moved) return;
    if (drag.mode === 'spin') {
      const it = drag.item;
      const ang = drag.spin0 + dx / innerWidth * Math.PI * 2 * CONFIG.dragSensitivity;
      const lim = CONFIG.maxSpinAngle * DEG;
      const next = clamp(ang, -lim, lim);
      const dtp = Math.max(1, now - drag.lastT) / 1000;
      const inst = clamp((next - it.spin) / dtp, -CONFIG.dragMaxVelocity * 60, CONFIG.dragMaxVelocity * 60);
      drag.vel = lerp(drag.vel, inst, 1 - CONFIG.dragVelocitySmoothing);
      it.spin = next; drag.lastT = now;
    } else if (swipe) {
      const perItem = (layout.narrow ? 0.55 : 0.3) * innerWidth;
      const dtp = Math.max(1, now - swipe.lastT);
      const inst = -(e.clientX - swipe.lastX) / perItem / (dtp / 1000);
      swipe.vel = lerp(swipe.vel, inst, 0.4);
      swipe.lastX = e.clientX; swipe.lastT = now;
      swipe.live = clamp(swipe.start - dx / perItem, -0.4, N - 0.6);
      swipe.pxVel = Math.abs(e.clientX - drag.x0) / Math.max(1, now - drag.t0);
    }
    dirty = true;
  });

  hero.addEventListener('pointerdown', e => {
    if (flight || !introDoneForInput() || e.button > 0) return;
    if (e.target.closest('a, button')) return;
    setPointer(e);
    const h = pick();
    drag = { x0: e.clientX, y0: e.clientY, t0: performance.now(), lastT: performance.now(), item: h?.item || null, moved: false, mode: null, vel: 0, spin0: h?.item.spin || 0 };
    if (h) { h.item.pressX = h.lx; h.item.pressY = h.ly; h.item.spinVel = 0; }
    hero.setPointerCapture(e.pointerId);
  });

  function endPointer(e) {
    if (!drag) return;
    const d = drag; drag = null;
    hero.classList.remove('is-grabbing');
    if (!d.moved) {
      if (d.item && e.type === 'pointerup') {
        if (d.item.i === target) open(target); else goTo(d.item.i);
      }
    } else if (d.mode === 'spin') {
      d.item.spinVel = d.vel;
    } else if (swipe) {
      const s = swipe; swipe = null;
      x = s.live; v = clamp(s.vel, -12, 12);
      let next = Math.round(s.live);
      const flick = (s.pxVel || 0) > CONFIG.touchFlickVelocity;
      if (next === target && flick) next = target + Math.sign(s.live - s.start || -s.vel);
      if (next !== target) goTo(next, { fromUser: false });
    }
    setPointer(e); updateHover();
  }
  hero.addEventListener('pointerup', endPointer);
  hero.addEventListener('pointercancel', endPointer);
  hero.addEventListener('pointerleave', e => { if (!drag) { hovered = null; setPill(null); hero.classList.remove('is-hovering'); } });

  // ── Open: fly out, then go to the catalog with this issue selected ──
  function open(index) {
    if (flight) return;
    const z = ZINES[index];
    if (reduce) { location.href = detailUrl(z); return; }
    flight = { index, start: clock };
    try { sessionStorage.setItem('junki-flight', z.slug); } catch (e) {}
    hero.classList.add('is-leaving');
    setPill(null);
    setTimeout(() => { location.href = detailUrl(z); }, 650);
  }
  // coming back with the browser's back button restores the page from cache
  addEventListener('pageshow', e => { if (e.persisted) { flight = null; hero.classList.remove('is-leaving'); dirty = true; } });

  $('order-cta').addEventListener('click', e => { e.preventDefault(); open(target); });


  // ── Debug panel (?debug) ───────────────────────────────────────────
  if (new URLSearchParams(location.search).has('debug')) {
    import('https://cdn.jsdelivr.net/npm/lil-gui@0.19.2/+esm').then(({ default: GUI }) => {
      const gui = new GUI({ title: 'Junki hero' });
      for (const k of Object.keys(CONFIG)) gui.add(CONFIG, k).onChange(() => { resize(); dirty = true; });
    }).catch(() => {});
  }

  // ── Preload → intro ────────────────────────────────────────────────
  (async () => {
    await waitForFonts();
    const first = items.filter(it => Math.abs(it.i - startIndex) <= CONFIG.renderRadius);
    let done = 0;
    const tick = () => { preloaderCount.textContent = Math.round(done / first.length * 100) + '%'; };
    tick();
    for (const it of first) {
      await loadTextures(it);
      done++; tick();
      await new Promise(r => requestAnimationFrame(r)); // keep the counter moving
    }
    // compile shaders now, while the preloader is still up, so the intro doesn't stall
    for (const it of items) it.group.visible = true;
    renderer.compile(scene, camera);
    for (const it of items) it.group.visible = false;
    runIntro();
  })();

  function runIntro() {
    const reveal = () => {
      document.documentElement.removeAttribute('data-preload');
      introStart = clock; target = startIndex; x = startIndex;
      startScribble(startIndex);
      setTimeout(() => hero.classList.add('is-ready'), reduce ? 0 : 1400);
    };
    if (reduce) {
      preloader.classList.add('is-done'); reveal(); return;
    }
    preloader.classList.add('is-covering');
    setTimeout(() => {
      preloader.classList.add('is-revealing');
      reveal();
      setTimeout(() => preloader.classList.add('is-done'), 700);
    }, 650);
  }

  hero.focus({ preventScroll: true });
  requestAnimationFrame(t => { lastT = t; frame(t); });
}

// ── Shared DOM helpers ───────────────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function rowsHTML(rows, startI) {
  let i = startI;
  return rows.map(([label, values]) => {
    const vals = (Array.isArray(values) ? values : [values]).map(val => `<span class="mask"><span class="line" style="--i:${i++}">${esc(val)}</span></span>`).join('');
    return `<div class="meta__row"><span class="rule" style="--i:${i}"></span><span class="mask"><span class="meta__label line" style="--i:${i}">${esc(label)}</span></span><span class="meta__value">${vals}</span></div>`;
  }).join('');
}

function renderMeta(index, animate) {
  const z = ZINES[index]; if (!z) return;
  metaEl.innerHTML =
    `<h2 class="meta__title"><span class="mask"><span class="line" style="--i:0">${esc(z.title)}</span></span></h2>` +
    rowsHTML([
      ['Issue', z.issue || '—'],
      ['Year', z.year || '—'],
      ['Contributors', (z.contributors && z.contributors.length) ? z.contributors : '—'],
    ], 1);
  notesEl.innerHTML = rowsHTML([
    ['Format', 'A5, stapled'],
    ['Price', z.price || '—'],
    ['Tip', coarse ? 'Swipe to browse' : 'Drag to flip'],
  ], 2);
  for (const el of [metaEl, notesEl]) {
    el.classList.remove('is-out');
    if (animate) {
      el.classList.add('is-pre');
      void el.offsetWidth; // apply the start state before animating in
      el.classList.remove('is-pre');
    }
  }
}

function announce(index) {
  const z = ZINES[index]; if (!z) return;
  liveEl.textContent = [z.issue, z.title, z.year].filter(Boolean).join(', ');
}
