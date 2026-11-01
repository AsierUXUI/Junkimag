// Junki home page and zine pages, as one page.
// Home: a diagonal row of 3D zines. Scroll steps one zine at a time, drag
// flips a zine to its back cover, printer's crop marks frame the zine in front.
// Clicking the zine in front opens its detail view (index.html?zine=<slug>):
// the same 3D zine moves out of the row into the detail hero, so there is no
// page load in between. The detail content lives in detail.js.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { makeCover, waitForFonts } from './covers.js';
import { createZineKit } from './zine-mesh.js';
import { createWheelStepper } from './wheel-steps.js';
import { createDetailView } from './detail.js';
import { createTrail } from './trail.js';

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
  mobileDrop: 0.08,      // phones: how far the row sits below the middle (× screen height)
  // intro
  preloadSpin: 1.1, preloadRiseFrom: 3, preloadRiseDepth: 0.7, preloadFanDuration: 1.15, preloadStagger: 0.07,
  // opening a zine: the others drop back out of view, the chosen one moves into the detail hero
  openDuration: 1.1, closeDuration: 0.9, othersRecede: 4, othersDrop: 2.5, othersRate: 4,
  // detail hero choreography (scroll-driven)
  detailScrollRange: 0.45, detailRise: 0.24, detailTilt: 20,
  detailScaleFrom: 1.25, detailScaleTo: 0.8, detailMobileScaleFrom: 1.1, detailMobileScaleTo: 0.75,
  detailExposure: 1.0, detailKeyIntensity: 1.3,
  // crop marks around the zine in front (px)
  marksEnabled: 1, marksGap: 10, marksLength: 22, marksDrawTime: 0.5,
  marksFollow: 11, marksSpread: 14, marksBoil: 0.7, marksBoilFps: 10,
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
const metaEl = $('meta'), liveEl = $('live');
const pill = $('cursor-pill'), pillText = $('cursor-pill-text');
const badgeEl = $('badge'), shapeEl = $('shape');
const preloader = $('preloader'), preloaderCount = $('preloader-count');

const detailUrl = z => '?zine=' + encodeURIComponent(z.slug);
const slugFromUrl = () => new URLSearchParams(location.search).get('zine');
const indexOfSlug = slug => ZINES.findIndex(z => z.slug === slug);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// riso ink-dot mouse trail, in the inks of the zine in front / the open zine
const trail = createTrail();

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
    const a = document.createElement('a'); a.href = 'catalog.html?zine=' + encodeURIComponent(z.slug); a.setAttribute('aria-label', z.title);
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
  // extra light from the left for the detail view, faded in with it
  const detailKey = new THREE.DirectionalLight(0xffffff, 0);
  detailKey.position.set(-1, 0.35, 0.9);
  scene.add(key, fill, rim, strip, detailKey);

  const gallery = new THREE.Group();
  scene.add(gallery);

  // ── Zine meshes ────────────────────────────────────────────────────
  const kit = createZineKit(renderer, { height: CONFIG.zineHeight, thickness: CONFIG.zineThickness, envIntensity: CONFIG.environmentIntensity });
  const { ZW, ZH, ZT } = kit;

  const items = ZINES.map((zine, i) => {
    const z = zine.kind === 'set' ? kit.buildSet(zine, ZINES.filter(o => o.kind !== 'set')) : kit.build(zine);
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
  const entryIndex = indexOfSlug(slugFromUrl());
  const startIndex = Math.max(0, entryIndex);
  let x = startIndex, v = 0, target = startIndex;   // spring on the float index
  let dirty = true, lastT = performance.now(), clock = 0;
  let introStart = -1, introDone = reduce;
  let mode = 'home', detailIndex = -1, away = 0;      // away: 0 = row in view, 1 = row gone (detail view)
  const detailTilt = { x: 0, y: 0 };
  let hovered = null, pointer = { x: -1e4, y: -1e4, nx: 0, ny: 0, ndc: new THREE.Vector2(), inside: false };
  let layout = { rotX: CONFIG.galleryRotX, rotY: CONFIG.galleryRotY, scale: CONFIG.galleryScale, gap: CONFIG.hGap, narrow: false };
  const raycaster = new THREE.Raycaster();

  function goTo(i, { fromUser = true } = {}) {
    const t = clamp(Math.round(i), 0, N - 1);
    if (t === target) return;
    target = t;
    if (reduce) { x = t; v = 0; }
    startMarks(t);
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
      // taller phones have more room under the row, so it drops a bit further toward the button
      const drop = clamp(CONFIG.mobileDrop + (1 / camera.aspect - 2) * 0.2, 0.04, 0.15);
      layout = { rotX: -14, rotY: -16, scale: s, gap: ZW * 1.08, narrow, drop: drop * visH };
    } else {
      const s = Math.min(CONFIG.galleryScale, 0.68 * visH / ZH);
      layout = { rotX: CONFIG.galleryRotX, rotY: CONFIG.galleryRotY, scale: s, gap: CONFIG.hGap, narrow };
    }
    gallery.rotation.set(layout.rotX * DEG, layout.rotY * DEG, 0);
    gallery.position.y = -(layout.drop || 0);
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
    detail.tick(now);
    trail.setInks(ZINES[mode === 'detail' ? detailIndex : target]?.inks);

    // the row steps back while a zine is open, and comes back after
    const awayTarget = mode === 'detail' ? 1 : 0;
    const prevAway = away;
    away = reduce ? awayTarget : away + (awayTarget - away) * damp(CONFIG.othersRate, dt);
    if (Math.abs(away - awayTarget) < 1e-3) away = awayTarget;

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

    let motion = Math.abs(x - prevX) + Math.abs(away - prevAway);
    const speed = Math.abs(v);
    const tIntro = introStart < 0 ? -1 : clock - introStart;
    if (tIntro >= 0 && !introDone && tIntro > 0.6 + CONFIG.preloadFanDuration + CONFIG.preloadStagger * 6) introDone = true;

    for (const it of items) {
      const d = it.i - x, ad = Math.abs(d);
      const inRange = ad <= CONFIG.renderRadius + 0.5 || !!it.override;
      it.group.visible = inRange && (introStart >= 0 || reduce);
      if (inRange && it.i !== detailIndex && !it.override && away > 0.97) it.group.visible = false;
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

      // a zine is open: the rest of the row drops back out of view (staggered by distance)
      if (away > 0 && it.i !== detailIndex) {
        const rank = Math.min(Math.abs(it.i - target), 4);
        const a = easeCubicInOut(clamp(away * (1.25 - rank * 0.06), 0, 1));
        iz -= CONFIG.othersRecede * a;
        iy -= CONFIG.othersDrop * a * (0.6 + rank * 0.1);
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

    // zines on their way into / out of / sitting in the detail view
    gallery.updateMatrixWorld(true);
    if (mode === 'detail' && !coarse && !reduce) {
      detailTilt.x += (pointer.ny * 0.06 - detailTilt.x) * damp(5, dt);
      detailTilt.y += (pointer.nx * 0.08 - detailTilt.y) * damp(5, dt);
    }
    for (const it of items) if (it.override) { applyOverride(it); motion += 1e-3; }
    renderer.toneMappingExposure = lerp(CONFIG.exposure, CONFIG.detailExposure, away);
    detailKey.intensity = CONFIG.detailKeyIntensity * away;

    const detailKeyNow = mode === 'detail' ? [detail.scroll(), detailTilt.x, detailTilt.y, innerWidth, innerHeight].map(n => n.toFixed(3)).join() : '';
    const detailChanged = detailKeyNow !== lastDetailKey; lastDetailKey = detailKeyNow;
    if (motion > 1e-5 || dirty || detailChanged) {
      gallery.updateMatrixWorld(true);
      renderer.render(scene, camera);
      dirty = false;
      marksDirty = true;
    }
    drawMarks(motion > 1e-5, dt);
    maybeSwapMeta();
  }
  const pillPos = { x: -100, y: -100 };
  let lastDetailKey = '';

  // ── Detail view: where the open zine sits, driven by page scroll ───
  const visH = () => 2 * CONFIG.cameraDistance * Math.tan(CONFIG.cameraFOV * DEG / 2);
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _qz = new THREE.Quaternion();
  const _p2 = new THREE.Vector3(), _q2 = new THREE.Quaternion(), _s2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();

  // World matrix of the zine in the detail hero for a given scroll position.
  // offsetVh moves it down (in viewport heights) for entering/leaving.
  function detailPose(sy, out, offsetVh = 0) {
    const W = innerWidth, H = innerHeight, mobile = W < 768;
    const H0 = mobile ? Math.min(0.7 * W / 0.705, 0.8 * H) : Math.min(0.569 * W, 0.85 * H);
    const p = clamp(sy / (CONFIG.detailScrollRange * H), 0, 1);
    const cyPage = 0.8 * H + H0 / 2 - CONFIG.detailRise * H * p + offsetVh * H;
    const cyView = cyPage - sy;
    const scale = lerp(mobile ? CONFIG.detailMobileScaleFrom : CONFIG.detailScaleFrom, mobile ? CONFIG.detailMobileScaleTo : CONFIG.detailScaleTo, p);
    const k = visH() / H;   // world units per CSS pixel on the z = 0 plane
    _p.set(0, -(cyView - H / 2) * k, 0);
    _qz.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -CONFIG.detailTilt * DEG * p);
    _q.setFromEuler(_e.set(detailTilt.x, p * Math.PI * 2 + detailTilt.y, 0));
    _q.premultiply(_qz);
    _s.setScalar(H0 * scale * k / ZH);
    return out.compose(_p, _q, _s);
  }

  function blendMatrix(a, b, t, out) {
    a.decompose(_p, _q, _s); b.decompose(_p2, _q2, _s2);
    _p.lerp(_p2, t); _q.slerp(_q2, t); _s.lerp(_s2, t);
    return out.compose(_p, _q, _s);
  }

  // The zine's natural transform in the row (what the carousel would show).
  function naturalWorld(it, out) {
    _m.compose(it.inner.position, it.inner.quaternion, it.inner.scale);
    return out.multiplyMatrices(it.group.matrixWorld, _m);
  }

  // Overrides place a zine directly in world space, on top of the row layout.
  //   kind 'detail': follow the detail pose (blending in from `from`)
  //   kind 'exit':   leave the detail view downwards, then drop the override
  //   kind 'return': blend back into the row, then drop the override
  const _target = new THREE.Matrix4(), _world = new THREE.Matrix4();
  function applyOverride(it) {
    const o = it.override;
    const t = o.dur > 0 ? clamp((clock - o.start) / o.dur, 0, 1) : 1;
    const e = easeCubicInOut(t);
    if (o.kind === 'detail') detailPose(detail.scroll(), _target);
    else if (o.kind === 'exit') detailPose(0, _target, 1.25);
    else naturalWorld(it, _target);
    if (o.from && t < 1) blendMatrix(o.from, _target, e, _world); else _world.copy(_target);
    it.group.visible = true;
    it.inner.matrixAutoUpdate = false;
    _inv.copy(it.group.matrixWorld).invert();
    it.inner.matrix.multiplyMatrices(_inv, _world);
    it.inner.updateMatrixWorld(true);
    if (t >= 1 && o.kind !== 'detail') {
      it.override = null;
      it.inner.matrixAutoUpdate = true;
      if (o.kind === 'return' && mode === 'home') startMarks(target, true);
    }
  }
  function currentWorld(it) { it.inner.updateMatrixWorld(true); return it.inner.matrixWorld.clone(); }


  // ── Crop marks ─────────────────────────────────────────────────────
  // Printer's crop marks frame the zine in front, with a registration target,
  // the issue number and its two ink swatches, like a print proof.
  // Motion: the frame chases the zine with a little lag (each corner at its
  // own pace, so it skews as it travels), glides across to the next zine on
  // every change, spreads out while moving and snaps back in when it lands,
  // and the lines "boil" slightly at 10 fps like hand-registered print.
  const sctx = scribbleCanvas.getContext('2d');
  let marks = null, marksDirty = true, disp = null, travel = 0, lastBoil = -1, spin = 0;

  function startMarks(index, force = false) {
    if (!CONFIG.marksEnabled) return;
    if (marks && marks.index === index && !force) return;
    const fresh = !marks || force;
    marks = { index, start: fresh ? clock : marks.start };
    if (force) disp = null;        // coming back from a zine page: draw on again
    marksDirty = true;
  }

  const tmpV = new THREE.Vector3();
  function screenCorners(item) {
    const w = scribbleCanvas.width, h = scribbleCanvas.height;
    return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
      tmpV.set(sx * item.dims.w / 2, sy * item.dims.h / 2, item.dims.d / 2);
      item.mesh.localToWorld(tmpV);
      tmpV.project(camera);
      return [(tmpV.x * 0.5 + 0.5) * w, (-tmpV.y * 0.5 + 0.5) * h];
    });
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const unit = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const along = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k];
  const boilAt = (seed, tick) => { const s = Math.sin(seed * 127.1 + tick * 311.7) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };

  function strokeMarks(item, corners, progress, tick) {
    const dpr = scribbleCanvas.width / Math.max(1, hero.clientWidth);
    const boil = reduce ? 0 : CONFIG.marksBoil * dpr;
    const jit = (k, axis) => boil * boilAt(k * 7.3 + axis, tick);
    const [TL, TR, BR, BL] = corners.map((c, k) => [c[0] + jit(k, 1), c[1] + jit(k, 2)]);
    // spread out while travelling, snap in when settled
    const gap = (CONFIG.marksGap + (1 - progress) * 16 + travel * CONFIG.marksSpread) * dpr;
    const lenFor = k => CONFIG.marksLength * dpr * easeCubicOut(clamp(progress * 1.4 - k * 0.1, 0, 1)) * (1 - travel * 0.35);
    sctx.save();
    sctx.globalAlpha = Math.min(1, progress * 2);
    sctx.strokeStyle = '#111'; sctx.fillStyle = '#111';
    sctx.lineWidth = 1.15 * dpr; sctx.lineCap = 'butt';
    sctx.beginPath();
    // each corner: one mark on the extension of each edge, not touching the zine
    [[TL, TR, BL], [TR, TL, BR], [BR, BL, TR], [BL, BR, TL]].forEach(([c, nh, nv], k) => {
      const len = lenFor(k);
      for (const n of [nh, nv]) {
        const d = unit(sub(c, n));
        const p0 = along(c, d, gap), p1 = along(c, d, gap + len);
        sctx.moveTo(p0[0], p0[1]); sctx.lineTo(p1[0], p1[1]);
      }
    });
    sctx.stroke();

    // registration target above the top edge; it rolls as the frame travels
    const topMid = [(TL[0] + TR[0]) / 2, (TL[1] + TR[1]) / 2];
    const botMid = [(BL[0] + BR[0]) / 2, (BL[1] + BR[1]) / 2];
    const up = unit(sub(topMid, botMid)), down = [-up[0], -up[1]];
    const rc = along(topMid, up, gap + 10 * dpr), r = 6 * dpr * progress;
    sctx.save();
    sctx.translate(rc[0], rc[1]); sctx.rotate(spin + boilAt(9.1, tick) * (reduce ? 0 : 0.03));
    sctx.beginPath();
    sctx.arc(0, 0, r, 0, Math.PI * 2);
    sctx.moveTo(-r * 1.7, 0); sctx.lineTo(r * 1.7, 0);
    sctx.moveTo(0, -r * 1.7); sctx.lineTo(0, r * 1.7);
    sctx.stroke();
    sctx.restore();

    // slug line under the bottom edge: issue number + the zine's two inks (dips while travelling)
    let b1 = BL, b2 = BR;
    if (b1[0] > b2[0]) [b1, b2] = [b2, b1];   // keep the text upright when the zine is flipped
    const ang = Math.atan2(b2[1] - b1[1], b2[0] - b1[0]);
    const z = item.zine;
    sctx.globalAlpha = clamp(progress * 1.6 - 0.5, 0, 1) * (1 - Math.min(1, travel * 2.5));
    sctx.save();
    const tp = along(b1, down, gap + 12 * dpr);
    sctx.translate(tp[0], tp[1]); sctx.rotate(ang);
    sctx.font = `700 ${9.5 * dpr}px "Space Mono", ui-monospace, monospace`;
    sctx.textBaseline = 'middle';
    if ('letterSpacing' in sctx) sctx.letterSpacing = `${1.6 * dpr}px`;
    sctx.fillText(`JUNKI ${z.issue || ''}`.toUpperCase(), gap + 4 * dpr, 0);   // starts clear of the corner mark
    sctx.restore();
    sctx.save();
    const sp = along(b2, down, gap + 12 * dpr);
    sctx.translate(sp[0], sp[1]); sctx.rotate(ang);
    const sq = 8 * dpr;
    (z.inks || ['#FF48B0', '#0078BF']).slice(0, 2).forEach((ink, i) => {
      sctx.fillStyle = ink; sctx.fillRect(-gap - 4 * dpr - sq * (2 - i) - (1 - i) * 3 * dpr, -sq / 2, sq, sq);
    });
    sctx.restore();
    sctx.restore();
  }

  function drawMarks(moving, dt = 1 / 60) {
    if (!introDone && introStart >= 0) {
      // the first marks wait for the fan-out to land
      const t = clock - introStart;
      if (t < 0.55 + CONFIG.preloadFanDuration * 0.6) { if (marks) marks.start = clock; }
    }
    const hidden = mode !== 'home' || introStart < 0 || items.some(it => it.override);
    if (hidden) {
      if (marksDirty) { sctx.clearRect(0, 0, scribbleCanvas.width, scribbleCanvas.height); marksDirty = false; }
      disp = null;
      return;
    }
    const item = marks && items[marks.index];
    if (!item || !item.group.visible) return;
    const progress = reduce ? 1 : easeCubicOut(clamp((clock - marks.start) / CONFIG.marksDrawTime, 0, 1));

    // chase the zine: every corner eases toward its target at a slightly different pace
    const goal = screenCorners(item);
    const diag = Math.hypot(scribbleCanvas.width, scribbleCanvas.height);
    let off = 0;
    if (!disp || reduce) disp = goal.map(c => c.slice());
    else goal.forEach((g, k) => {
      const kk = damp(CONFIG.marksFollow * (1 - k * 0.09), dt);
      disp[k][0] += (g[0] - disp[k][0]) * kk; disp[k][1] += (g[1] - disp[k][1]) * kk;
      off += Math.hypot(g[0] - disp[k][0], g[1] - disp[k][1]);
    });
    const travelNow = clamp(off / diag * 6, 0, 1);
    const prevTravel = travel;
    travel += (travelNow - travel) * damp(10, dt);
    spin += (disp ? (travel * 6) : 0) * dt;

    const tick = reduce ? 0 : Math.floor(clock * CONFIG.marksBoilFps);
    const settling = progress < 1 || off > 0.5 || Math.abs(travel - prevTravel) > 1e-4;
    if (!moving && !marksDirty && !settling && tick === lastBoil) return;
    lastBoil = tick; marksDirty = false;
    sctx.clearRect(0, 0, scribbleCanvas.width, scribbleCanvas.height);
    strokeMarks(item, disp, progress, tick);
  }

  // ── Meta block ─────────────────────────────────────────────────────
  let shownIndex = -1, swapping = false;
  function maybeSwapMeta() {
    if (swapping || shownIndex === target || introStart < 0 || mode !== 'home') return;
    if (!introDone && clock - introStart < 0.9) return;
    if (Math.abs(x - target) < 0.15 && Math.abs(v) < 2.5) swapMeta(target);
  }
  function swapMeta(index) {
    swapping = true;
    const first = shownIndex < 0;
    const done = () => { shownIndex = index; swapping = false; announce(index); };
    if (first || reduce) { renderMeta(index, !reduce && first); done(); return; }
    metaEl.classList.add('is-out');
    setTimeout(() => { renderMeta(index, true); done(); }, 360);
  }

  // ── Input: wheel ───────────────────────────────────────────────────
  const wheelSteps = createWheelStepper(CONFIG, dir => step(dir));
  addEventListener('wheel', e => {
    if (mode !== 'home') return;   // the detail view scrolls normally
    e.preventDefault();
    if (!introDoneForInput()) return;
    const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    wheelSteps(raw, e.deltaMode, performance.now());
  }, { passive: false });

  function introDoneForInput() { return introStart >= 0 && (introDone || clock - introStart > 0.9); }

  // ── Input: keyboard ────────────────────────────────────────────────
  addEventListener('keydown', e => {
    if (mode !== 'home' || !introDoneForInput()) return;
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
    if (drag || mode !== 'home' || coarse) { setPill(null); return; }
    hovered = pick();
    hero.classList.toggle('is-hovering', !!hovered);
    setPill(hovered);
    dirty = true;
  }
  function setPill(h) { showPill(h ? (h.item.i === target ? 'See this issue' : 'Bring to front') : null); }
  function showPill(text) {
    if (coarse) return;
    pill.classList.toggle('is-visible', !!text);
    if (text) pillText.textContent = text;
  }
  addEventListener('pointermove', e => {
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.nx = e.clientX / innerWidth * 2 - 1; pointer.ny = e.clientY / innerHeight * 2 - 1;
  });

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
    if (mode !== 'home' || !introDoneForInput() || e.button > 0) return;
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

  // ── Open / close a zine (no page load) ─────────────────────────────
  const detail = createDetailView({
    zines: ZINES,
    showPill,
    onOpenZine: slug => switchDetail(indexOfSlug(slug)),
    onHome: () => closeDetail(),
  });

  function openDetail(index, { push = true, fromBelow = false } = {}) {
    if (index < 0 || mode === 'detail') return;
    const it = items[index];
    if (!it.loaded) loadTextures(it);
    goTo(index, { fromUser: false });
    x = index; v = 0;
    hovered = null; setPill(null); hero.classList.remove('is-hovering', 'is-grabbing'); drag = null; swipe = null;
    gallery.updateMatrixWorld(true);
    const from = fromBelow ? detailPose(0, new THREE.Matrix4(), 0.7) : currentWorld(it);
    mode = 'detail'; detailIndex = index;
    it.spin = 0; it.spinVel = 0;
    it.override = { kind: 'detail', from, start: clock, dur: reduce ? 0 : CONFIG.openDuration };
    if (push) history.pushState({ zine: ZINES[index].slug }, '', detailUrl(ZINES[index]));
    detail.show(ZINES[index]);
    marksDirty = true; dirty = true;
  }

  function closeDetail({ push = true } = {}) {
    if (mode !== 'detail') return;
    const it = items[detailIndex];
    const from = currentWorld(it);
    detail.hide();
    mode = 'home';
    it.override = { kind: 'return', from, start: clock, dur: reduce ? 0 : CONFIG.closeDuration };
    detailIndex = -1;
    if (push) history.pushState({}, '', location.pathname);
    document.title = 'Junki Magazine';
    hero.focus({ preventScroll: true });
    dirty = true;
  }

  // From one zine's page to another (the "Other issues" cards).
  function switchDetail(index) {
    if (index < 0) return;
    if (mode !== 'detail') { openDetail(index); return; }
    if (index === detailIndex) return;
    const old = items[detailIndex];
    old.override = { kind: 'exit', from: currentWorld(old), start: clock, dur: reduce ? 0 : 0.7 };
    const it = items[index];
    if (!it.loaded) loadTextures(it);
    target = index; x = index; v = 0;
    detailIndex = index;
    it.spin = 0; it.spinVel = 0;
    it.override = { kind: 'detail', from: detailPose(0, new THREE.Matrix4(), 0.9), start: clock + (reduce ? 0 : 0.15), dur: reduce ? 0 : CONFIG.openDuration };
    history.pushState({ zine: ZINES[index].slug }, '', detailUrl(ZINES[index]));
    detail.show(ZINES[index]);
    dirty = true;
  }

  function open(index) { openDetail(index); }

  // restored from the browser's back/forward cache: drop any loading screen
  addEventListener('pageshow', e => {
    if (!e.persisted) return;
    document.documentElement.removeAttribute('data-preload');
    preloader.classList.add('is-done');
    dirty = true;
  });

  // browser back / forward
  addEventListener('popstate', () => {
    const i = indexOfSlug(slugFromUrl());
    if (i < 0) closeDetail({ push: false });
    else if (mode !== 'detail') openDetail(i, { push: false });
    else if (i !== detailIndex) {
      // same as switchDetail, without adding a history entry
      const old = items[detailIndex];
      old.override = { kind: 'exit', from: currentWorld(old), start: clock, dur: reduce ? 0 : 0.7 };
      const it = items[i]; if (!it.loaded) loadTextures(it);
      target = i; x = i; v = 0; detailIndex = i;
      it.override = { kind: 'detail', from: detailPose(0, new THREE.Matrix4(), 0.9), start: clock, dur: reduce ? 0 : CONFIG.openDuration };
      detail.show(ZINES[i]);
    }
  });

  // phones: "See more" opens the zine in front
  $('see-more').addEventListener('click', () => { if (mode === 'home') open(target); });

  $('order-cta').addEventListener('click', e => {
    e.preventDefault();
    if (mode === 'detail') window.JunkiOrder?.open(ZINES[detailIndex].title);
    else open(target);
  });

  // ── Debug panel (?debug) ───────────────────────────────────────────
  if (new URLSearchParams(location.search).has('debug')) {
    import('https://cdn.jsdelivr.net/npm/lil-gui@0.19.2/+esm').then(({ default: GUI }) => {
      const gui = new GUI({ title: 'Junki hero' });
      for (const k of Object.keys(CONFIG)) gui.add(CONFIG, k).onChange(() => { resize(); dirty = true; });
    }).catch(() => {});
  }

  // ── Preload → intro ────────────────────────────────────────────────
  // Coming back in the same session (e.g. back from About us): no loading
  // screen, the zines just fan in again once their covers are ready.
  let quick = false;
  try { quick = sessionStorage.getItem('junki-visited') === '1'; sessionStorage.setItem('junki-visited', '1'); } catch (e) {}
  if (quick) preloader.classList.add('is-done');

  (async () => {
    try {
      await waitForFonts();
      const first = items.filter(it => Math.abs(it.i - startIndex) <= CONFIG.renderRadius);
      let done = 0;
      const tick = () => { preloaderCount.textContent = Math.round(done / first.length * 100) + '%'; };
      tick();
      for (const it of first) {
        await loadTextures(it);
        done++; tick();
        // let the counter repaint (a timeout, not a frame: frames pause in background tabs)
        await new Promise(r => setTimeout(r, 0));
      }
      // compile shaders now, while the preloader is still up, so the intro doesn't stall
      for (const it of items) it.group.visible = true;
      renderer.compile(scene, camera);
      for (const it of items) it.group.visible = false;
    } catch (err) {
      console.error(err);   // never leave the visitor on the loading screen
    }
    runIntro();
  })();

  function runIntro() {
    const reveal = () => {
      document.documentElement.removeAttribute('data-preload');
      introStart = clock; target = startIndex; x = startIndex;
      if (entryIndex >= 0) {
        // opened straight from a link to a zine: skip the fan-out, the zine rises into its page
        introDone = true; away = 1;
        openDetail(entryIndex, { push: false, fromBelow: true });
        hero.classList.add('is-ready');
        return;
      }
      startMarks(startIndex);
      setTimeout(() => hero.classList.add('is-ready'), reduce ? 0 : 1400);
    };
    if (reduce || quick) {
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
  // one table, desktop and phones: contributors live on the zine's own page
  metaEl.innerHTML =
    `<h2 class="meta__title"><span class="mask"><span class="line" style="--i:0">${esc(z.title)}</span></span></h2>` +
    rowsHTML([
      ['Issue', z.issue || '—'],
      ['Year', z.year || '—'],
      ['Format', z.kind === 'set' ? 'Slipcase' : 'A5, stapled'],
      ['Price', window.junkiPrice(z) || '—'],
    ], 1);
  metaEl.classList.remove('is-out');
  if (animate) {
    metaEl.classList.add('is-pre');
    void metaEl.offsetWidth; // apply the start state before animating in
    metaEl.classList.remove('is-pre');
  }
}

function announce(index) {
  const z = ZINES[index]; if (!z) return;
  liveEl.textContent = [z.issue, z.title, z.year].filter(Boolean).join(', ');
}
