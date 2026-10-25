import * as THREE from 'three';
import { createCreatures } from './creatures.js';

/* Night sky for the hero: NASA LRO moon (lit sphere + relief), real star field, procedural corner cobwebs with dew. */

const hero = document.querySelector('.hero');
const canvas = document.getElementById('sky');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) { console.warn('WebGL unavailable, sky skipped', e); }

if (renderer) {
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.autoClear = false;

  /* ---------------- moon ---------------- */
  const sceneMoon = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  cam.position.z = 12;
  const FOV_H = 2 * Math.tan(THREE.MathUtils.degToRad(15)) * 12; // world height visible at z = 0

  const phone = innerWidth < 700;
  const tex = new THREE.TextureLoader().load(phone ? 'assets/moon_color_2k.jpg' : 'assets/moon_color.jpg', () => { canvas.classList.add('ready'); dirty = true; });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1, phone ? 96 : 150, phone ? 96 : 150),
    new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 2.4, roughness: 1, metalness: 0 })
  );
  moon.rotation.set(0.1, -Math.PI / 2, 0.08); // near side toward the viewer, slight tilt
  sceneMoon.add(moon);

  const sun = new THREE.DirectionalLight(0xfff0da, 4.6);
  sun.position.set(-4.2, 2.4, 3.4); // from upper left: a gibbous phase with a real terminator
  sceneMoon.add(sun);
  sceneMoon.add(new THREE.HemisphereLight(0x7b92c4, 0x05070b, 0.1)); // faint earthshine on the dark limb

  // scattered light around the moon, cool white, falling off like a real exposure
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec2 vUv;
        void main(){
          float d = length(vUv - .5) * 2.;
          float x = max(d - .2, 0.);
          float g = .20 * exp(-x * 20.) + .075 * exp(-x * 6.) + .028 * exp(-x * 2.4);
          g *= pow(clamp(1. - d, 0., 1.), 1.6);
          vec3 c = vec3(.74, .84, 1.) * g; gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
        }`
    })
  );
  halo.renderOrder = -1;
  sceneMoon.add(halo);

  /* ---------------- stars (screen space) ---------------- */
  const N = innerWidth < 700 ? 900 : 1700;
  const sp = new Float32Array(N * 3), sa = new Float32Array(N * 4); // pos, [mag, phase, temp, size]
  for (let i = 0; i < N; i++) {
    sp[i * 3] = Math.random() * 2 - 1;
    sp[i * 3 + 1] = Math.random() * 2 - 1;
    const b = Math.pow(Math.random(), 3.2);      // few bright, many faint
    sa[i * 4] = 0.25 + 0.75 * b;
    sa[i * 4 + 1] = Math.random() * 6.28;
    sa[i * 4 + 2] = Math.random();
    sa[i * 4 + 3] = 0.9 + 2.6 * b * b;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('aStar', new THREE.BufferAttribute(sa, 4));
  starGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: `attribute vec4 aStar; uniform float uTime, uPx; varying vec3 vC; varying float vA;
      void main(){
        float tw = 1. + .22 * sin(uTime * (1.2 + aStar.z * 2.) + aStar.y);
        vec3 cold = vec3(.72,.82,1.), warm = vec3(1.,.82,.62);
        vC = mix(cold, warm, smoothstep(.55,1.,aStar.z)) ;
        vA = aStar.x * tw * smoothstep(-.7, .25, position.y);   // dimmer toward the horizon haze
        gl_PointSize = aStar.w * uPx;
        gl_Position = vec4(position.xy, 0., 1.);
      }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main(){
        float d = length(gl_PointCoord - .5);
        float a = exp(-d * d * 30.) * vA;
        gl_FragColor = vec4(vC * a, a);
      }`
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false; stars.renderOrder = -2;
  sceneMoon.add(stars);

  /* ---------------- cobwebs ---------------- */
  const sceneWeb = new THREE.Scene();
  const camWeb = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1); // pixel space, y down
  let webs = [];
  const cr = createCreatures();

  const lineMat = (origin, R) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    uniforms: { uTime: { value: 0 }, uOrigin: { value: origin }, uR: { value: R } },
    vertexShader: `attribute float aAlpha; varying float vA; uniform float uTime, uR; uniform vec2 uOrigin;
      vec2 sway(vec2 p){ float w = pow(length(p - uOrigin) / uR, 2.);
        return vec2(sin(uTime * .55 + p.y * .012 + p.x * .004) * 1.8, sin(uTime * .85 + p.x * .011) * 2.4) * w; }
      void main(){ vA = aAlpha; vec2 p = position.xy + sway(position.xy);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0., 1.); }`,
    fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(.80,.88,1.) * vA, vA); }'
  });

  const dewMat = (origin, R, light, px) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    uniforms: { uTime: { value: 0 }, uOrigin: { value: origin }, uR: { value: R }, uLight: { value: light }, uPx: { value: px } },
    vertexShader: `attribute float aSize; attribute float aPhase; varying float vP; uniform float uTime, uR, uPx; uniform vec2 uOrigin;
      vec2 sway(vec2 p){ float w = pow(length(p - uOrigin) / uR, 2.);
        return vec2(sin(uTime * .55 + p.y * .012 + p.x * .004) * 1.8, sin(uTime * .85 + p.x * .011) * 2.4) * w; }
      void main(){ vP = aPhase; vec2 p = position.xy + sway(position.xy);
        gl_PointSize = aSize * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0., 1.); }`,
    fragmentShader: `varying float vP; uniform float uTime; uniform vec2 uLight;
      void main(){
        vec2 c = gl_PointCoord * 2. - 1.;
        float r = length(c);
        if (r > 1.) discard;
        vec3 n = vec3(c, sqrt(1. - r * r));
        vec3 L = normalize(vec3(uLight, .75));
        float diff = max(dot(n, L), 0.) * .22;
        float spec = pow(max(dot(reflect(-L, n), vec3(0., 0., 1.)), 0.), 36.) * (1.1 + .7 * sin(uTime * 1.1 + vP));
        float rim = smoothstep(.55, 1., r) * .28;                    // refractive edge
        float caustic = pow(max(dot(n, -L), 0.), 5.) * .30;          // light focused through the drop
        vec3 col = vec3(.70,.84,1.) * (diff + rim + caustic) + vec3(1.) * spec;
        float a = smoothstep(1., .82, r);
        gl_FragColor = vec4(col * a, a * clamp(max(col.r, max(col.g, col.b)) * 1.4, 0., 1.));
      }`
  });

  const rnd = (a, b) => a + Math.random() * (b - a);

  function buildWeb(W, H, side, R, light, px) {
    const ox = side ? W : 0, sx = side ? -1 : 1;
    const L = [], A = [], D = [], DS = [], DP = [];
    const seg = (a, b, al) => { L.push(ox + sx * a[0], a[1], 0, ox + sx * b[0], b[1], 0); A.push(al, al); };
    const dew = (p, s) => { D.push(ox + sx * p[0], p[1], 0); DS.push(s); DP.push(Math.random() * 6.28); };
    const poly = (pts, al, dewGap, dewSize) => {
      let acc = rnd(0, dewGap || 1);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ai = al * rnd(.8, 1.15);
        seg(a, b, ai);
        if (dewGap) {
          const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
          acc += d;
          if (acc >= dewGap) { acc = 0; const t = Math.random(); dew([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dewSize * rnd(.6, 1.3) * (Math.random() < .06 ? 1.6 : 1)); }
        }
      }
    };

    const nRad = 9;
    const ang = [], len = [];
    for (let i = 0; i < nRad; i++) {
      const edge = i === 0 || i === nRad - 1;
      ang.push((i / (nRad - 1)) * Math.PI / 2 + (edge ? 0 : rnd(-.05, .05)));
      len.push(edge ? R * 1.02 : R * rnd(.8, 1.06));
    }
    const dir = ang.map(a => [Math.cos(a), Math.sin(a)]);
    const o = [1.5, 1.5]; // keep the edge threads just inside the viewport

    // radial threads (the dry, strong ones)
    for (let i = 0; i < nRad; i++) {
      const pts = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const wob = Math.sin(t * 9 + i) * .8;
        pts.push([o[0] + dir[i][0] * len[i] * t - dir[i][1] * wob, o[1] + dir[i][1] * len[i] * t + dir[i][0] * wob]);
      }
      poly(pts, i === 0 || i === nRad - 1 ? .55 : .5, 0, 0);
    }

    // capture threads: sagging arcs between neighbouring radials, with dew beads
    const rings = 9 + (Math.random() * 3 | 0);
    let f = .13;
    for (let k = 0; k < rings; k++) {
      f += rnd(.07, .105);
      if (f > .98) break;
      for (let i = 0; i < nRad - 1; i++) {
        if (Math.random() < .07) continue; // torn gaps
        const a = [o[0] + dir[i][0] * len[i] * f, o[1] + dir[i][1] * len[i] * f];
        const b = [o[0] + dir[i + 1][0] * len[i + 1] * f, o[1] + dir[i + 1][1] * len[i + 1] * f];
        const sag = rnd(.045, .095) * (.6 + f);
        const n = 14, pts = [];
        const nz = rnd(0, 6.28);
        for (let j = 0; j <= n; j++) {
          const t = j / n, s = Math.sin(Math.PI * t);
          const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
          pts.push([o[0] + (x - o[0]) * (1 - sag * s) + Math.sin(t * 17 + nz) * .5, o[1] + (y - o[1]) * (1 - sag * s) + Math.cos(t * 13 + nz) * .5]);
        }
        poly(pts, rnd(.2, .36), rnd(8, 15), 1.5 + f * 2.3);
      }
    }

    // loose strands hanging from the outer ends
    for (const i of [2, 4, 6, 7]) {
      if (Math.random() < .25) continue;
      const end = [o[0] + dir[i][0] * len[i], o[1] + dir[i][1] * len[i]];
      const dl = rnd(26, 82), pts = [], drift = rnd(-10, 14);
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        pts.push([end[0] + drift * t * t + Math.sin(t * 5 + i) * 1.2, end[1] + dl * t]);
      }
      poly(pts, .38, 11, 2.4);
      dew(pts[pts.length - 1], rnd(3.2, 4.4)); // a heavy drop at the tip
    }

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(L, 3));
    lg.setAttribute('aAlpha', new THREE.Float32BufferAttribute(A, 1));
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(D, 3));
    dg.setAttribute('aSize', new THREE.Float32BufferAttribute(DS, 1));
    dg.setAttribute('aPhase', new THREE.Float32BufferAttribute(DP, 1));
    lg.boundingSphere = dg.boundingSphere = new THREE.Sphere(new THREE.Vector3(W / 2, H / 2, 0), Math.max(W, H) * 2);

    const origin = new THREE.Vector2(ox + sx * o[0], o[1]);
    const lines = new THREE.LineSegments(lg, lineMat(origin, R));
    const dots = new THREE.Points(dg, dewMat(origin, R, light, px));
    lines.frustumCulled = dots.frustumCulled = false;
    return [lines, dots];
  }

  /* ---------------- layout + loop ---------------- */
  let W = 1, H = 1, dirty = true, running = false, clockStart = performance.now();

  function layout() {
    W = hero.clientWidth; H = hero.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, (navigator.hardwareConcurrency || 4) <= 4 ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    cam.aspect = W / H; cam.updateProjectionMatrix();
    camWeb.left = 0; camWeb.right = W; camWeb.top = 0; camWeb.bottom = H; camWeb.updateProjectionMatrix();
    starMat.uniforms.uPx.value = dpr;

    // moon: pixel radius → world units at z = 0
    const rPx = THREE.MathUtils.clamp(W * 0.07, 62, 125);
    const cx = W * 0.5, cy = rPx + Math.max(34, H * 0.04);
    const p2w = FOV_H / H, rW = rPx * p2w;
    moon.scale.setScalar(rW);
    moon.position.set((cx - W / 2) * p2w, (H / 2 - cy) * p2w, 0);
    halo.scale.setScalar(rW * 10);
    halo.position.set(moon.position.x, moon.position.y, -0.2);

    // webs
    webs.forEach(w => { sceneWeb.remove(w); w.geometry.dispose(); w.material.dispose(); });
    webs = [];
    const R = W < 600 ? Math.min(W * 0.5, 200) : Math.min(W * 0.34, H * 0.52, 360);
    [0, 1].forEach(side => {
      const wx = side ? W - R * .5 : R * .5;
      const light = new THREE.Vector2(cx - wx, cy - R * .4).normalize();
      buildWeb(W, H, side, R, light, dpr).forEach(m => { sceneWeb.add(m); webs.push(m); });
    });
    cr.layout(W, H, { cx, cy });
    dirty = true;
  }

  let last = performance.now();
  function draw(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const t = reduce ? 0 : (now - clockStart) / 1000;
    moon.rotation.y = -Math.PI / 2 + Math.sin(t * 0.05) * 0.035; // slow libration
    starMat.uniforms.uTime.value = t;
    webs.forEach(m => { m.material.uniforms.uTime.value = t; });
    renderer.clear();
    renderer.render(sceneMoon, cam);
    renderer.clearDepth();
    renderer.render(sceneWeb, camWeb);
    cr.update(reduce ? 0 : t, reduce ? 0 : dt);
    renderer.clearDepth();
    renderer.render(cr.scene, cr.camera);
    dirty = false;
  }

  function loop(now) {
    if (!running) return;
    draw(now);
    requestAnimationFrame(loop);
  }
  const setRunning = on => {
    if (reduce) { dirty && draw(performance.now()); return; }
    if (on && !running) { running = true; requestAnimationFrame(loop); }
    else if (!on) running = false;
  };

  new ResizeObserver(() => { layout(); if (reduce || !running) draw(performance.now()); }).observe(hero);
  new IntersectionObserver(es => setRunning(es[0].isIntersecting)).observe(hero);
  document.addEventListener('visibilitychange', () => setRunning(!document.hidden));
  addEventListener('load', () => setTimeout(layout, 250));
  layout();
  if (reduce) { tex.addEventListener?.('load', () => draw(performance.now())); draw(performance.now()); }
}
