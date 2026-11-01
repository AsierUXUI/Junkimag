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
    return { inner, mesh, front, back, loaded: false };
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

  return { ZW, ZH, ZT, build, loadTextures };
}
