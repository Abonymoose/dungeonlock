import * as THREE from 'three';
import { C, VIEW, ROWS } from './config.js';
import { world } from './world.js';
import { settings } from './settings.js';

export const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap; // hard-edged shadows suit pixel art
document.body.prepend(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(C.ONYX);

// Fixed isometric angle; only the position moves, so the screen axes never change
const CAM_OFFSET = new THREE.Vector3(20, 20, 20);
export const camera = new THREE.OrthographicCamera();
camera.near = 1; camera.far = 80;
camera.position.copy(CAM_OFFSET);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

// Screen directions on the ground, so stick-up moves up the screen
export const GROUND_UP = new THREE.Vector3(-CAM_OFFSET.x, 0, -CAM_OFFSET.z).normalize();
export const GROUND_RIGHT = new THREE.Vector3().crossVectors(GROUND_UP, new THREE.Vector3(0, 1, 0));

// 4-step toon ramp: banded light, so torch pools read as pixel-art rings instead of smooth gradients
export const ramp = new THREE.DataTexture(new Uint8Array([40, 110, 190, 255]), 4, 1, THREE.RedFormat);
ramp.needsUpdate = true;
export const toon = (color, map = null) => new THREE.MeshToonMaterial({ color, map, gradientMap: ramp });
export const basic = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, ...opts });

// Torchlit dungeon: dim cold fill, one soft key light for shadows, warm point lights do the rest
const hemi = new THREE.HemisphereLight(0x8a6d60, 0x131515, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xb8c0d0, 1.3); // cool moonlight from above: shape and shadows
sun.position.set(-6, 15, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0015;
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 50 });
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun, sun.target);

// The player carries a little warm light, like Hades' glow, so you're never lost in the dark
export const playerLight = new THREE.PointLight(0xffc890, 6, 5, 1.6);
playerLight.position.y = 1.6;
scene.add(playerLight);

// Fixed light pools: changing the number of lights makes three.js recompile every shader, which stutters.
// Rooms claim torch lights; effects borrow flash lights that fade out.
export const torchLights = Array.from({ length: 12 }, () => {
  const l = new THREE.PointLight(0xff9a50, 0, 10, 1.3);
  scene.add(l);
  return l;
});
const flashes = Array.from({ length: 4 }, () => {
  const l = new THREE.PointLight(0xffffff, 0, 6, 1.5);
  scene.add(l);
  return { l, t: 0, max: 1, peak: 0 };
});
let nextFlash = 0;
export function flashLight(pos, color, peak = 12, dur = 0.25) {
  const f = flashes[nextFlash++ % flashes.length];
  f.l.position.set(pos.x, 1.2, pos.z);
  f.l.color.setHex(color);
  Object.assign(f, { t: dur, max: dur, peak });
}

export function updateLights(dt, time) {
  for (const f of flashes) {
    f.t = Math.max(0, f.t - dt);
    f.l.intensity = f.peak * (f.t / f.max);
  }
  // torches flicker a little, each on its own phase
  torchLights.forEach((l, i) => {
    if (l.userData.base) l.intensity = l.userData.base * (0.85 + 0.15 * Math.sin(time * 11 + i * 2.3) * Math.sin(time * 7.3 + i));
  });
}

// ---- low-res render target + post pass (outlines, grade) ----

let rt = null, cssW = 1, cssH = 1, ppu = 24; // art pixels per world unit, set by resize
const post = new THREE.ShaderMaterial({
  uniforms: { tColor: { value: null }, tDepth: { value: null }, texel: { value: new THREE.Vector2() }, flash: { value: 0 }, grade: { value: new THREE.Vector3(1.0, 0.86, 0.68) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tColor, tDepth; uniform vec2 texel; uniform float flash; uniform vec3 grade;
    varying vec2 vUv;
    float depthAt(vec2 o) { return texture2D(tDepth, vUv + o * texel).r; }
    // how much a pixel glows: bright AND coloured (flames, bolts, orbs), so lit bone and armour don't bloom
    vec3 bright(vec2 o) {
      vec3 s = texture2D(tColor, vUv + o * texel).rgb;
      float mx = max(s.r, max(s.g, s.b)), sat = (mx - min(s.r, min(s.g, s.b))) / max(mx, 0.001);
      return s * smoothstep(0.45, 0.9, mx) * sat * sat;
    }
    void main() {
      vec4 c = texture2D(tColor, vUv);
      // 1px outline on the near side of depth edges: the crisp border pixel art has
      float d = depthAt(vec2(0.0));
      float far = max(max(depthAt(vec2(1.0, 0.0)), depthAt(vec2(-1.0, 0.0))), max(depthAt(vec2(0.0, 1.0)), depthAt(vec2(0.0, -1.0))));
      float edge = step(0.004, far - d);
      c.rgb = mix(c.rgb, c.rgb * 0.3, edge);
      // grade: pull shadows toward Onyx, warm the mids toward parchment
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 warm = mix(vec3(0.0075, 0.0075, 0.0085), grade, l);
      c.rgb = mix(c.rgb, warm * (0.6 + l), 0.22);
      // glow: bright coloured pixels (flames, telegraphs, bolts, pickups) bleed a few art pixels into their surroundings
      vec3 glow = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        vec2 dir = vec2(cos(float(i) * 0.785398), sin(float(i) * 0.785398));
        glow += bright(dir * 2.0) + bright(dir * 5.0) * 0.5;
      }
      c.rgb += glow * 0.09;
      // vignette: the edges of the screen sink into the dark, so the eye stays on the fight
      vec2 q = (vUv - 0.5) * vec2(1.5, 1.0);
      c.rgb *= mix(1.0, smoothstep(0.95, 0.3, length(q)), 0.5);
      c.rgb = mix(c.rgb, vec3(0.6, 0.02, 0.02), flash);   // red pulse when the player is hurt
      gl_FragColor = c;
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
});
// Each biome sets its own ambient, key light and colour grade
export function setMood(b) {
  hemi.color.setHex(b.sky);
  hemi.groundColor.setHex(b.ground);
  hemi.intensity = b.amb;
  sun.color.setHex(b.sun);
  sun.intensity = b.sunI ?? 1.3;
  post.uniforms.grade.value.set(...b.grade);
}

const postScene = new THREE.Scene();
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// Render at low resolution, then scale up by a whole number for crisp, even pixels
export function resize() {
  // whole device pixels per art pixel: phones (pixel ratio 2-3) stay crisp and as chunky as a desktop
  const dpr = devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor(innerHeight * dpr / ROWS));
  const w = Math.ceil(innerWidth * dpr / scale), h = Math.ceil(innerHeight * dpr / scale);
  cssW = w * scale / dpr; cssH = h * scale / dpr;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = cssW + 'px';
  renderer.domElement.style.height = cssH + 'px';
  rt?.dispose();
  rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: new THREE.DepthTexture(w, h) });
  post.uniforms.tColor.value = rt.texture;
  post.uniforms.tDepth.value = rt.depthTexture;
  post.uniforms.texel.value.set(1 / w, 1 / h);
  ppu = h / VIEW;
  Object.assign(camera, { left: -w / 2 / ppu, right: w / 2 / ppu, top: h / 2 / ppu, bottom: -h / 2 / ppu });
  camera.updateProjectionMatrix();
  // the UI unit in CSS px: whole pixels on a desktop; on a short phone screen a bit bigger so text stays readable
  const u = innerHeight < 2 * ROWS ? innerHeight / 150 : Math.floor(innerHeight / ROWS);
  document.documentElement.style.setProperty('--u', u + 'px');
}
addEventListener('resize', resize);
resize();

export function draw() {
  post.uniforms.flash.value = Math.max(0, (world.player?.hurtT ?? 0) - 0.45) * 0.9;
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
}

const focus = new THREE.Vector3();
export function updateCamera(dt, target, instant = false) {
  if (instant) focus.copy(target);
  else focus.lerp(target, 1 - Math.exp(-8 * dt));
  camera.position.copy(focus).add(CAM_OFFSET);
  if (!settings.shake) world.shake = 0;
  if (world.shake > 0) {
    world.shake = Math.max(0, world.shake - dt);
    const s = world.shake * 0.6;
    camera.position
      .addScaledVector(camRight, (Math.random() - 0.5) * s)
      .addScaledVector(camUp, (Math.random() - 0.5) * s);
  }
  // snap to whole screen pixels so the floor doesn't shimmer while the camera moves
  const px = 1 / ppu;
  const r = camera.position.dot(camRight), u = camera.position.dot(camUp);
  camera.position
    .addScaledVector(camRight, Math.round(r / px) * px - r)
    .addScaledVector(camUp, Math.round(u / px) * px - u);
  camera.updateMatrixWorld();
  // the shadow light follows the view in 4-unit steps (moving it smoothly makes shadow edges crawl)
  const sx = Math.round(focus.x / 4) * 4, sz = Math.round(focus.z / 4) * 4;
  sun.position.set(sx - 6, 15, sz + 4);
  sun.target.position.set(sx, 0, sz);
  const lit = world.player?.pos ?? target;
  playerLight.position.set(lit.x, 1.6, lit.z);
}

const v = new THREE.Vector3(), viewDir = new THREE.Vector3();

// The floor point under a screen position (CSS pixels), for mouse aiming
export function screenToGround(x, y) {
  v.set((x / cssW) * 2 - 1, 1 - (y / cssH) * 2, -1).unproject(camera);
  camera.getWorldDirection(viewDir);
  const t = -v.y / viewDir.y;
  return new THREE.Vector3(v.x + viewDir.x * t, 0, v.z + viewDir.z * t);
}
// World position to CSS pixels, for damage numbers and labels
export function toScreen(p, lift = 0) {
  v.set(p.x, p.y + lift, p.z).project(camera);
  return { x: (v.x + 1) / 2 * cssW, y: (1 - v.y) / 2 * cssH };
}
