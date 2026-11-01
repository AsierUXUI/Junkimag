// The 3D zine (cover, back, page edges, staples), shared by the home page
// carousel and the zine detail page.

import * as THREE from 'three';
import { makeCover, makeGrain, makePageEdge } from './covers.js';

export function createZineKit(renderer, { height = 2, thickness = 0.012, envIntensity = 0.55 } = {}) {
  const ZH = height, ZW = ZH * 148 / 210, ZT = thickness;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const grainTex = new THREE.CanvasTexture(makeGrain());
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping; grainTex.repeat.set(3, 4);
  const edgeV = new THREE.CanvasTexture(makePageEdge('v')); edgeV.colorSpace = THREE.SRGBColorSpace;
  const edgeH = new THREE.CanvasTexture(makePageEdge('h')); edgeH.colorSpace = THREE.SRGBColorSpace;
  const edgeMatV = new THREE.MeshPhysicalMaterial({ map: edgeV, roughness: 0.95, metalness: 0 });
  const edgeMatH = new THREE.MeshPhysicalMaterial({ map: edgeH, roughness: 0.95, metalness: 0 });
  const stapleMat = new THREE.MeshPhysicalMaterial({ color: 0xc9c9c9, metalness: 1, roughness: 0.3 });
  const boxGeo = new THREE.BoxGeometry(ZW, ZH, ZT);
  const stapleGeo = new THREE.CylinderGeometry(ZH * 0.00175, ZH * 0.00175, ZH * 0.06, 8);

  function paperMaterial(zine) {
    const glossy = zine.paper === 'glossy';
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: glossy ? 0.6 : 0.85, metalness: 0,
      clearcoat: glossy ? 0.35 : 0, clearcoatRoughness: 0.3,
      sheen: 0.15, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff),
      roughnessMap: grainTex, bumpMap: grainTex, bumpScale: 0.25,
      envMapIntensity: envIntensity,
    });
  }

  // Returns { inner, mesh, front, back }: `inner` is the group to rotate/position.
  function build(zine) {
    const front = paperMaterial(zine), back = paperMaterial(zine);
    const spine = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(zine.inks?.[0] || '#ddd'), roughness: 0.85 });
    // box faces: +x fore edge, -x spine, +y top, -y bottom, +z front, -z back
    const mesh = new THREE.Mesh(boxGeo, [edgeMatV, spine, edgeMatH, edgeMatH, front, back]);
    const inner = new THREE.Group(); inner.add(mesh);
    for (const y of [-ZH / 4, ZH / 4]) {
      const s = new THREE.Mesh(stapleGeo, stapleMat); s.position.set(-ZW / 2 - ZH * 0.00075, y, 0); inner.add(s);
    }
    return { inner, mesh, front, back, loaded: false, dims: { w: ZW, h: ZH, d: ZT } };
  }

  // ── Box set: a slipcase holding every zine, a poster and a sticker sheet ──
  // Open on the right side so the spines show in the carousel, with a thumb
  // notch cut into the front and back panels at the open edge.
  const BW = ZW * 1.06, BH = ZH * 1.035, BD = ZH * 0.2, WALL = ZH * 0.006;

  function spineTexture(label, bg, fg) {
    const c = document.createElement('canvas'); c.width = 96; c.height = 768;
    const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 96, 768);
    x.save(); x.translate(48, 384); x.rotate(Math.PI / 2);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '800 44px "Bricolage Grotesque", "Arial Black", sans-serif';
    x.fillText(label, 0, 0);
    x.restore();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
    return t;
  }

  // mirror = notch on the left; used for the back panel, which is turned around
  function panelGeometry(mirror = false) {
    const r = BH * 0.08, sh = new THREE.Shape(), e = mirror ? -1 : 1;
    sh.moveTo(-e * BW / 2, -BH / 2);
    sh.lineTo(e * BW / 2, -BH / 2);
    sh.lineTo(e * BW / 2, -r);
    sh.absarc(e * BW / 2, 0, r, -Math.PI / 2, Math.PI / 2, !mirror);   // thumb notch at the open edge
    sh.lineTo(e * BW / 2, BH / 2);
    sh.lineTo(-e * BW / 2, BH / 2);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: WALL, bevelEnabled: false, curveSegments: 24 });
    // extrude UVs are in shape units; map them to 0..1 across the panel
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / BW + 0.5, uv.getY(i) / BH + 0.5);
    return g;
  }

  function buildSet(set, zines) {
    const inner = new THREE.Group();
    const paper = c => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c), roughness: 0.85, metalness: 0, sheen: 0.15, sheenRoughness: 0.8, roughnessMap: grainTex, bumpMap: grainTex, bumpScale: 0.25, envMapIntensity: envIntensity });
    const front = paperMaterial(set), back = paperMaterial(set);
    const edge = paper('#ece8df');
    const fp = new THREE.Mesh(panelGeometry(), [front, edge]); fp.position.z = BD / 2 - WALL; inner.add(fp);
    // back panel: drawn mirrored, then turned around, so the notch is on the open side and its print reads correctly
    const bp = new THREE.Mesh(panelGeometry(true), [back, edge]); bp.rotation.y = Math.PI; bp.position.z = -BD / 2 + WALL; inner.add(bp);
    const side = paper(set.inks?.[0] || '#FF48B0');
    const top = new THREE.Mesh(new THREE.BoxGeometry(BW, WALL, BD), edge); top.position.y = BH / 2 - WALL / 2; inner.add(top);
    const bot = top.clone(); bot.position.y = -BH / 2 + WALL / 2; inner.add(bot);
    const closed = new THREE.Mesh(new THREE.BoxGeometry(WALL, BH, BD), side); closed.position.x = -BW / 2 + WALL / 2; inner.add(closed);

    // what's inside, spines facing the open side
    // poster and stickers at the back, zines in front (a zine shows through the thumb notch)
    const slots = [{ label: 'STICKERS', bg: '#111', fg: '#F4F1EA' }, { label: 'POSTER', bg: '#F4F1EA', fg: '#FF48B0', poster: true }]
      .concat(zines.map(z => ({ label: `JUNKI ${z.issue || ''}`.toUpperCase(), bg: z.inks?.[0] || '#FF48B0', fg: '#111' })));
    const innerD = BD - WALL * 2 - ZH * 0.004;
    const slabD = innerD / slots.length;
    const slabGeo = new THREE.BoxGeometry(BW - WALL * 2 - ZH * 0.02, BH - WALL * 2 - ZH * 0.012, slabD * 0.9);
    slots.forEach((sl, k) => {
      const body = paper(sl.poster ? '#F4F1EA' : sl.bg);
      const spine = new THREE.MeshPhysicalMaterial({ map: spineTexture(sl.label, sl.bg, sl.fg), roughness: 0.8, metalness: 0, envMapIntensity: envIntensity });
      const m = new THREE.Mesh(slabGeo, [spine, body, body, body, body, body]);
      m.position.set(-ZH * 0.008 + (k % 3) * ZH * 0.002, 0, -innerD / 2 + slabD * (k + 0.5));
      inner.add(m);
    });

    // invisible box for clicks and hover
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BW, BH, BD), new THREE.MeshBasicMaterial({ visible: false }));
    inner.add(mesh);
    return { inner, mesh, front, back, loaded: false, isSet: true, dims: { w: BW, h: BH, d: BD } };
  }

  // Generates both covers and puts them on the materials.
  async function loadTextures(item, zine) {
    if (item.loaded) return; item.loaded = true;
    const [f, b] = await Promise.all([makeCover(zine, 'front'), makeCover(zine, 'back')]);
    for (const [mat, c] of [[item.front, f], [item.back, b]]) {
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
      mat.map = t; mat.needsUpdate = true;
    }
    item.frontCanvas = f; item.backCanvas = b;
  }

  return { ZW, ZH, ZT, build, buildSet, loadTextures };
}
