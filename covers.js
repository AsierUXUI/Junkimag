// Generates riso-style cover art for a zine on a <canvas>.
// Used when a zine in zines.js has no front/back image yet, and to add
// the print look (halftone, misregistration, grain, wear) to real scans.

export const COVER_W = 1024;
export const COVER_H = 1453; // A5 portrait, 148:210

const PAPER = '#F4F1EA';
const DISPLAY = '"Bricolage Grotesque", "Arial Black", sans-serif';
const MONO = '"Space Mono", ui-monospace, monospace';

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = seed || 1;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvas(w = COVER_W, h = COVER_H) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

let fontsReady = null;
export function waitForFonts() {
  if (!fontsReady) {
    fontsReady = Promise.race([
      Promise.all([
        document.fonts.load(`800 200px ${DISPLAY}`),
        document.fonts.load(`700 40px ${MONO}`),
      ]),
      new Promise(r => setTimeout(r, 2500)),
    ]).catch(() => {});
  }
  return fontsReady;
}

// Turn a grey "tint" layer into halftone dots of one ink.
function halftone(ctx, tint, ink, cell, offX, offY) {
  const w = tint.width, h = tint.height;
  const data = tint.getContext('2d').getImageData(0, 0, w, h).data;
  ctx.save();
  ctx.fillStyle = ink;
  ctx.globalCompositeOperation = 'multiply';
  ctx.beginPath();
  for (let y = cell / 2; y < h; y += cell) {
    const shift = (Math.round(y / cell) % 2) * cell / 2; // staggered grid reads more like print
    for (let x = cell / 2 + shift; x < w; x += cell) {
      const i = ((y | 0) * w + (x | 0)) * 4;
      const cov = 1 - data[i] / 255;
      if (cov < 0.04) continue;
      const r = Math.min(cell * 0.72, cell * 0.62 * Math.sqrt(cov));
      ctx.moveTo(x + offX + r, y + offY);
      ctx.arc(x + offX, y + offY, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

// Paper grain, light creases, scuffed corners.
function paperFinish(ctx, rand, amount = 1) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const g = canvas(256, 256), gx = g.getContext('2d');
  const img = gx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + rand() * 55; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  gx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.35 * amount;
  ctx.fillStyle = ctx.createPattern(g, 'repeat');
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // creases: a thin light line beside a thin dark one
  ctx.save();
  for (let k = 0; k < 2; k++) {
    const y = h * (0.25 + rand() * 0.5), tilt = (rand() - 0.5) * 120;
    ctx.globalAlpha = 0.18 * amount; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w * 0.55, y); ctx.lineTo(w, y + tilt); ctx.stroke();
    ctx.globalAlpha = 0.08 * amount; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(w * 0.55, y + 3); ctx.lineTo(w, y + tilt + 3); ctx.stroke();
  }
  // corner wear: soft paper-coloured scuffs where the ink rubbed off
  ctx.fillStyle = PAPER;
  for (const [cx, cy] of [[w, 0], [w, h], [0, h], [0, 0]]) {
    for (let k = 0; k < 14; k++) {
      ctx.globalAlpha = (0.15 + rand() * 0.3) * amount;
      ctx.beginPath();
      ctx.arc(cx + (rand() - 0.5) * 60, cy + (rand() - 0.5) * 60, 4 + rand() * 18, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawFrontArt(zine, rand) {
  const [inkA, inkB] = zine.inks || ['#FF48B0', '#0078BF'];
  const W = COVER_W, H = COVER_H;
  const solidA = canvas(), sa = solidA.getContext('2d');
  const solidB = canvas(), sb = solidB.getContext('2d');
  const tintA = canvas(), ta = tintA.getContext('2d');
  const tintB = canvas(), tb = tintB.getContext('2d');
  for (const t of [ta, tb]) { t.fillStyle = '#fff'; t.fillRect(0, 0, W, H); t.fillStyle = '#000'; }
  sa.fillStyle = inkA; sb.fillStyle = inkB;

  const layout = Math.floor(rand() * 3);

  // Ink B tint: a big shape behind everything
  tb.globalAlpha = 0.45 + rand() * 0.3;
  if (layout === 0) {
    tb.beginPath(); tb.arc(W * (0.35 + rand() * 0.3), H * (0.45 + rand() * 0.15), W * (0.38 + rand() * 0.12), 0, Math.PI * 2); tb.fill();
  } else if (layout === 1) {
    tb.save(); tb.translate(W / 2, H / 2); tb.rotate((rand() - 0.5) * 0.6);
    for (let i = -8; i < 8; i++) tb.fillRect(i * 110, -H, 55, H * 2);
    tb.restore();
  } else {
    tb.beginPath(); tb.moveTo(0, H * 0.3);
    for (let x = 0; x <= W; x += 64) tb.lineTo(x, H * 0.3 + Math.sin(x / 120 + rand()) * 60 + rand() * 30);
    tb.lineTo(W, H); tb.lineTo(0, H); tb.closePath(); tb.fill();
  }
  // Ink A tint: a gradient wash so the dot size varies
  const grad = ta.createLinearGradient(0, H * 0.2, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.75)');
  ta.fillStyle = grad; ta.fillRect(0, H * 0.55, W, H * 0.45);

  // Ink A solid: masthead and issue number
  sa.textBaseline = 'alphabetic';
  sa.font = `800 300px ${DISPLAY}`;
  sa.save(); sa.translate(W / 2, 330);
  const m = sa.measureText('JUNKI'); const fit = Math.min(1, (W - 110) / m.width);
  sa.scale(fit, fit * 1.12); sa.textAlign = 'center'; sa.fillText('JUNKI', 0, 0); sa.restore();
  sa.font = `700 34px ${MONO}`; sa.textAlign = 'left';
  sa.fillText('MAGAZINE', 64, 410);
  sa.textAlign = 'right'; sa.fillText(String(zine.year || ''), W - 64, 410);

  // Ink B solid: big issue number and small marks
  const isSet = zine.kind === 'set';
  sb.font = `800 ${isSet ? 330 : 520}px ${DISPLAY}`; sb.textAlign = 'right';
  const num = isSet ? 'SET' : ((zine.issue || '').replace(/[^0-9]/g, '') || '00');
  sb.save(); sb.translate(W - 40, H - 120); sb.rotate(-0.06 + rand() * 0.04); sb.fillText(num, 0, 0); sb.restore();
  sb.font = `700 30px ${MONO}`; sb.textAlign = 'left';
  sb.fillText(zine.issue || '', 64, H - 70);
  for (let i = 0; i < 6; i++) { sb.beginPath(); sb.arc(80 + rand() * (W - 160), 470 + rand() * (H * 0.4), 6 + rand() * 18, 0, Math.PI * 2); sb.fill(); }

  return { inkA, inkB, solidA, solidB, tintA, tintB };
}

function drawBackArt(zine, rand) {
  const [inkA, inkB] = zine.inks || ['#FF48B0', '#0078BF'];
  const W = COVER_W, H = COVER_H;
  const solidA = canvas(), sa = solidA.getContext('2d');
  const solidB = canvas(), sb = solidB.getContext('2d');
  const tintA = canvas(), ta = tintA.getContext('2d');
  const tintB = canvas(), tb = tintB.getContext('2d');
  for (const t of [ta, tb]) { t.fillStyle = '#fff'; t.fillRect(0, 0, W, H); t.fillStyle = '#000'; }

  tb.globalAlpha = 0.35; tb.fillRect(0, 0, W, H * 0.42);
  ta.globalAlpha = 0.25; ta.beginPath(); ta.arc(W * 0.78, H * 0.28, 220, 0, Math.PI * 2); ta.fill();

  sa.fillStyle = inkA; sb.fillStyle = inkB;
  sa.font = `800 120px ${DISPLAY}`; sa.textAlign = 'left'; sa.fillText('JUNKI', 64, 190);
  sa.font = `700 34px ${MONO}`; sa.fillText(zine.issue || '', 64, 250);

  sb.font = `700 28px ${MONO}`; sb.textAlign = 'left';
  let y = H * 0.52;
  const line = (label, value) => {
    sb.globalAlpha = 0.6; sb.fillText(label, 64, y); sb.globalAlpha = 1;
    sb.textAlign = 'right'; sb.fillText(value, W - 64, y); sb.textAlign = 'left';
    sb.fillRect(64, y + 18, W - 128, 2); y += 72;
  };
  line('ISSUE', zine.issue || '—');
  line('YEAR', zine.year ? String(zine.year) : '—');
  (zine.contributors || []).forEach((c, i) => line(i === 0 ? 'CONTRIBUTORS' : '', c));
  line('PRICE', zine.price || '—');

  // barcode
  const bx = W - 64 - 300, by = H - 260;
  sb.fillStyle = '#1b1b1b';
  for (let x = 0; x < 290;) { const bw = 2 + Math.floor(rand() * 6); if (rand() > 0.4) sb.fillRect(bx + x, by, bw, 150); x += bw + 2 + Math.floor(rand() * 4); }
  sb.font = `700 22px ${MONO}`; sb.fillText('9 770000 ' + String(hash(zine.slug)).slice(0, 6), bx, by + 190);

  return { inkA, inkB, solidA, solidB, tintA, tintB };
}

function composite(art, rand, cell) {
  const out = canvas(), ctx = out.getContext('2d');
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, COVER_W, COVER_H);
  const mis = () => (rand() * 2 - 1) * 3; // 1–3px misregistration per ink
  const ax = mis(), ay = mis(), bx = mis(), by = mis();
  halftone(ctx, art.tintB, art.inkB, cell, bx, by);
  halftone(ctx, art.tintA, art.inkA, cell, ax, ay);
  ctx.save(); ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.92; ctx.drawImage(art.solidB, bx, by);
  ctx.globalAlpha = 0.95; ctx.drawImage(art.solidA, ax, ay);
  ctx.restore();
  return out;
}

async function fromImage(src, rand) {
  const img = await loadImage(src);
  const out = canvas(), ctx = out.getContext('2d');
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, COVER_W, COVER_H);
  const s = Math.max(COVER_W / img.width, COVER_H / img.height);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(img, (COVER_W - img.width * s) / 2, (COVER_H - img.height * s) / 2, img.width * s, img.height * s);
  ctx.globalCompositeOperation = 'source-over';
  paperFinish(ctx, rand, 0.6);
  return out;
}

// side: 'front' | 'back'
export async function makeCover(zine, side = 'front', { cell = 7 } = {}) {
  await waitForFonts();
  const rand = rng(hash(zine.slug + side));
  const src = side === 'front' ? zine.front : zine.back;
  if (src) {
    try { return await fromImage(src, rand); } catch (e) { console.warn('Cover image failed, using generated cover:', src); }
  }
  const art = side === 'front' ? drawFrontArt(zine, rand) : drawBackArt(zine, rand);
  const out = composite(art, rand, cell);
  paperFinish(out.getContext('2d'), rand, 1);
  return out;
}

// Small tileable grain used for the paper's roughness and bump maps.
export function makeGrain(size = 256, seed = 7) {
  const rand = rng(seed);
  const c = canvas(size, size), x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 150 + rand() * 105; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

// Stack of sheets for the page edges. `across` picks the stripe direction
// so the sheets line up on both the side edges and the top/bottom edges.
export function makePageEdge(across = 'v') {
  const rand = rng(across === 'v' ? 11 : 12);
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#efece4'; x.fillRect(0, 0, 256, 256);
  for (let p = 0; p < 256; p += 8) {
    x.fillStyle = `rgba(60,50,40,${0.10 + rand() * 0.14})`;
    if (across === 'v') x.fillRect(p, 0, 2, 256); else x.fillRect(0, p, 256, 2);
  }
  return c;
}
