import * as THREE from 'three';

/* Procedural spiders, rendered in pixel space (y up) so they sit exactly on page elements. */


/* ---------------- spider ---------------- */
function abdomenTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 118, 10, 128, 128, 140);
  g.addColorStop(0, '#4a3220'); g.addColorStop(1, '#150c07');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) { x.fillStyle = `rgba(${150 + Math.random() * 80 | 0},${110 + Math.random() * 60 | 0},${70 + Math.random() * 40 | 0},${Math.random() * .12})`; x.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4); }
  x.fillStyle = 'rgba(226,205,160,.85)';
  for (const [px, py, r] of [[128, 70, 9], [100, 110, 7], [156, 110, 7], [128, 128, 10], [112, 158, 6], [144, 158, 6], [128, 186, 7]]) { x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); }
  x.strokeStyle = 'rgba(226,205,160,.5)'; x.lineWidth = 5; x.beginPath(); x.moveTo(128, 50); x.lineTo(128, 210); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makeSpider(S, seed) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  body.scale.setScalar(S);
  const skin = new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: .45, metalness: .05 });
  const ceph = new THREE.Mesh(new THREE.SphereGeometry(.5, 20, 16), skin); ceph.scale.set(.5, .62, .36); ceph.position.set(0, .28, 0); body.add(ceph);
  const abd = new THREE.Mesh(new THREE.SphereGeometry(.5, 24, 20), new THREE.MeshStandardMaterial({ map: abdomenTexture(), roughness: .55, metalness: 0 }));
  abd.scale.set(.74, .98, .68); abd.position.set(0, -.52, .04); body.add(abd);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: .1, metalness: .6 });
  for (const [x, y, r] of [[-.07, .55, .035], [.07, .55, .035], [-.16, .5, .026], [.16, .5, .026], [-.03, .6, .02], [.03, .6, .02]]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), eyeM); e.position.set(x, y, .15); body.add(e);
  }
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(.04, .14, 4, 8), skin); f.position.set(s * .1, .62, .06); body.add(f); } // chelicerae

  const legGeo = new THREE.CylinderGeometry(1, 1, 1, 7, 1); legGeo.translate(0, .5, 0);
  const legs = [];
  const base = [38, 68, 108, 146].map(d => THREE.MathUtils.degToRad(d));
  for (let side = -1; side <= 1; side += 2) base.forEach((a, k) => {
    const segs = [0, 1, 2].map(j => { const m = new THREE.Mesh(legGeo, skin); m.frustumCulled = false; body.add(m); return m; });
    legs.push({ a: Math.PI / 2 - side * a + (side < 0 ? 0 : 0), side, k, segs, ph: Math.random() * 6.28 });
  });
  const L = [.62, .74, .62];
  const R = [.05, .036, .022];
  const up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), q = new THREE.Quaternion();

  function pose(t, curl) {
    for (const lg of legs) {
      const dirx = Math.cos(lg.a), diry = Math.sin(lg.a);
      const wob = Math.sin(t * 1.3 + lg.ph) * .09 + Math.sin(t * 3.1 + lg.ph * 2) * .03;
      const e = [.75 + wob, -.2 + wob * 1.3 + curl * .1, -1.05 - curl * .35 + wob];
      const spread = 1 + .06 * Math.sin(t * .8 + lg.k);
      let p = new THREE.Vector3(dirx * .22, diry * .3 + .15, 0);
      for (let j = 0; j < 3; j++) {
        const h = Math.cos(e[j]) * L[j] * spread, z = Math.sin(e[j]) * L[j];
        const n = new THREE.Vector3(p.x + dirx * h, p.y + diry * h, p.z + z);
        const seg = lg.segs[j];
        v.subVectors(n, p); const len = v.length(); v.normalize();
        q.setFromUnitVectors(up, v);
        seg.position.copy(p); seg.quaternion.copy(q); seg.scale.set(R[j], len, R[j]);
        p = n;
      }
    }
  }
  return { root, body, pose, S, seed };
}

/* ---------------- manager ---------------- */
export function createCreatures() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1200, 1200); // y up, pixels
  scene.add(new THREE.HemisphereLight(0x9bb0e0, 0x2a1a10, 1.15));
  const key = new THREE.DirectionalLight(0xdfe8ff, 3.4); scene.add(key); scene.add(key.target);
  const warm = new THREE.DirectionalLight(0xffa25c, .35); warm.position.set(300, -200, 300); scene.add(warm);

  let W = 1, H = 1;
  const spiders = [];

  function layout(w, h, m) {
    W = w; H = h;
    camera.right = W; camera.top = H; camera.updateProjectionMatrix();
    key.position.set(m.cx, H - m.cy, 500);
    key.target.position.set(W / 2, H / 2, 0);

    spiders.forEach(s => { scene.remove(s.root); scene.remove(s.thread); s.thread.geometry.dispose(); });
    spiders.length = 0;

    const small = W < 640;
    // spiders hang from the top edge on silk
    [[.84, small ? 34 : 50, 0], [.16, small ? 22 : 30, 1]].forEach(([fx, S, i]) => {
      if (small && i === 1) return;
      const sp = makeSpider(S, i);
      const thread = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: 0xc8d2e6, transparent: true, opacity: .45 }));
      thread.frustumCulled = false;
      scene.add(sp.root, thread);
      spiders.push({ ...sp, thread, x0: W * fx, root: sp.root, ph: i * 2.1, drop: (small ? 100 : 150) + i * 40 });
    });
  }

  function update(t) {
    // descend, hang, twist, climb back, with a pendulum swing
    for (const s of spiders) {
      const cyc = (t * .09 + s.ph) % 1;
      const ease = x => x * x * (3 - 2 * x);
      const depth = cyc < .35 ? ease(cyc / .35) : cyc < .6 ? 1 : cyc < .9 ? 1 - ease((cyc - .6) / .3) : 0;
      const len = 40 + s.drop * depth + Math.sin(t * 1.4 + s.ph) * 3;
      const sw = Math.sin(t * .85 + s.ph) * .07 * (.4 + depth);
      const x = s.x0 + Math.sin(sw) * len, y = H - len * Math.cos(sw);
      s.root.position.set(x, y, 90);
      s.root.rotation.set(.62, Math.sin(t * .5 + s.ph) * .55, sw * 1.2 + Math.sin(t * .31 + s.ph) * .35 + Math.PI);
      s.pose(t + s.ph * 3, depth);
      const pts = s.thread.geometry.attributes.position;
      pts.setXYZ(0, s.x0, H + 4, 0); pts.setXYZ(1, x, y + s.S * .85 * Math.cos(sw), 0); pts.needsUpdate = true;
    }
  }

  return { scene, camera, layout, update };
}
