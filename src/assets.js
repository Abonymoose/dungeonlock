import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ramp } from './render.js';

// KayKit packs by Kay Lousberg (CC0): www.kaylousberg.com
const CHARACTERS = {
  Knight: 'adventurers/Knight', Mage: 'adventurers/Mage', Rogue_Hooded: 'adventurers/Rogue_Hooded', Barbarian: 'adventurers/Barbarian',
  Skeleton_Minion: 'skeletons/Skeleton_Minion', Skeleton_Warrior: 'skeletons/Skeleton_Warrior',
  Skeleton_Mage: 'skeletons/Skeleton_Mage', Skeleton_Rogue: 'skeletons/Skeleton_Rogue',
};
const PROPS = [
  'floor_tile_small', 'floor_tile_large', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B', 'floor_tile_small_decorated',
  'floor_tile_big_spikes', 'floor_foundation_front', 'floor_foundation_corner', 'wall', 'wall_doorway', 'wall_gated', 'wall_cracked',
  'pillar', 'pillar_decorated', 'torch_mounted', 'barrel_large', 'barrel_small', 'crates_stacked', 'rubble_half',
  'banner_patternA_red', 'banner_red', 'sword_shield_broken', 'candle_triple', 'box_large', 'chest',
];
// the Keep's weapon rack, from the KayKit Medieval Hexagon Pack
export const MEDIEVAL = ['weaponrack'];

const gltfs = {};
const toonCache = new Map();
const propMats = new Set(); // every material dungeon props share, so a biome can tint all its stone at once

// Swap the packs' standard materials for toon ones so everything shares the banded pixel-art lighting
function toonify(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    o.userData.shared = true; // geometry and material belong to the loaded asset; never dispose them per instance
    if (!toonCache.has(o.material)) {
      const m = o.material;
      if (m.map) { m.map.magFilter = THREE.NearestFilter; m.map.minFilter = THREE.NearestFilter; m.map.generateMipmaps = false; }
      toonCache.set(m, new THREE.MeshToonMaterial({ color: m.color, map: m.map, gradientMap: ramp, transparent: m.transparent, alphaTest: m.alphaTest }));
    }
    o.material = toonCache.get(o.material);
  });
}

// A placed copy of a Medieval piece (shared geometry and materials), scaled up from its hex-board size
export const MEDIEVAL_SCALE = 3.5;
export function medieval(name, s = MEDIEVAL_SCALE) {
  const o = gltfs[name].scene.clone();
  o.scale.setScalar(s);
  return o;
}

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  const jobs = [
    ...Object.entries(CHARACTERS).map(([k, p]) => [k, `assets/kaykit/${p}.glb`]),
    ...MEDIEVAL.map((n) => [n, `assets/kaykit/medieval/${n}.gltf`]),
    ...PROPS.map((n) => [n, `assets/kaykit/dungeon/${n}.glb`]),
  ];
  let done = 0;
  await Promise.all(jobs.map(async ([key, url]) => {
    gltfs[key] = await loader.loadAsync(url);
    toonify(gltfs[key].scene);
    if (PROPS.includes(key)) gltfs[key].scene.traverse((o) => { if (o.isMesh) propMats.add(o.material); });
    onProgress?.(++done / jobs.length);
  }));
}

export function tintProps(hex) {
  for (const m of propMats) m.color.setHex(hex);
}

// ---- static props ----

// A shared-material copy of a dungeon prop, at our scale (KayKit's 2-unit tile = our 1 unit)
export function prop(name, scale = 0.5) {
  const o = gltfs[name].scene.clone();
  o.scale.setScalar(scale);
  return o;
}

// One InstancedMesh per sub-mesh of a prop, placed at every matrix: cheap floors and walls
export function instanced(name, matrices, scale = 0.5) {
  const group = new THREE.Group(), src = gltfs[name].scene, s = new THREE.Matrix4().makeScale(scale, scale, scale);
  src.updateMatrixWorld(true);
  src.traverse((o) => {
    if (!o.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(s, o.matrixWorld), m = new THREE.Matrix4();
    const inst = new THREE.InstancedMesh(o.geometry, o.material, matrices.length);
    matrices.forEach((mat, i) => inst.setMatrixAt(i, m.multiplyMatrices(mat, local)));
    inst.castShadow = inst.receiveShadow = true;
    inst.userData.shared = true;
    group.add(inst);
  });
  return group;
}

// ---- animated characters ----

// Builds { root, body, mats, anim }. `hide` drops unused accessory meshes; `lend` borrows weapons from
// another character onto a hand bone: [fromCharacter, meshName, boneName]. GLTFLoader strips dots, so 'handslot.r' is 'handslotr'.
// Pull a material's texture toward a 3-colour palette ramp by luminance, keeping some of the original.
// This is how the pack's bright outfits are brought into Dungeonlock's palette.
function applyTint(mat, [dark, mid, light, amount]) {
  const v = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        float lum = clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) * 1.25, 0.0, 1.0);
        vec3 rampc = lum < 0.5 ? mix(${v(dark)}, ${v(mid)}, lum * 2.0) : mix(${v(mid)}, ${v(light)}, lum * 2.0 - 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, rampc, ${amount.toFixed(2)});
      }`);
  };
  mat.customProgramCacheKey = () => `tint${dark}-${mid}-${light}-${amount}`;
}

export function character(name, { scale = 0.5, hide = [], lend = [], anims = {}, tint = null } = {}) {
  const src = gltfs[name];
  const root = new THREE.Group(), body = cloneSkinned(src.scene);
  body.scale.setScalar(scale);
  root.add(body);
  for (const [from, mesh, bone] of lend) body.getObjectByName(bone).add(gltfs[from].scene.getObjectByName(mesh).clone());
  const mats = [];
  body.traverse((o) => {
    if (!o.isMesh) return;
    if (hide.includes(o.name)) { o.visible = false; return; }
    o.material = o.material.clone(); // per instance, so hits can flash just this one
    o.userData.ownMat = true;
    if (tint) applyTint(o.material, tint);
    o.frustumCulled = false;         // skinned bounds are unreliable once animated
    mats.push(o.material);
  });
  return { root, body, mats, anim: animator(body, src.animations, anims) };
}

// Small animation state machine: one looping base (idle/run) plus one-shots (attack, hit) that fade back.
function animator(body, clips, map) {
  const mixer = new THREE.AnimationMixer(body), actions = {};
  for (const [key, clipName] of Object.entries(map)) {
    const clip = THREE.AnimationClip.findByName(clips, clipName);
    if (clip) actions[key] = mixer.clipAction(clip);
  }
  let current = null, base = null, shotT = 0, held = false;
  const fadeTo = (next, t) => {
    if (!next || current === next) return;
    next.enabled = true;
    next.reset().fadeIn(t).play();
    current?.fadeOut(t);
    current = next;
  };
  return {
    has: (key) => !!actions[key],
    duration: (key) => actions[key]?.getClip().duration ?? 0,
    loop(key, speed = 1) {
      const a = actions[key];
      if (!a) return;
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.timeScale = speed;
      base = a;
      if (shotT <= 0 && !held) fadeTo(a, 0.15);
    },
    // play a one-shot squeezed into `dur` seconds (or its natural length); hold keeps the last frame (death)
    once(key, dur = 0, hold = false) {
      const a = actions[key];
      if (!a) return;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      const len = a.getClip().duration;
      a.timeScale = dur ? len / dur : 1;
      if (current === a) a.reset();
      fadeTo(a, 0.05);
      shotT = dur || len;
      held = hold;
    },
    update(dt) {
      mixer.update(dt);
      if (shotT > 0) {
        shotT -= dt;
        if (shotT <= 0 && !held) fadeTo(base, 0.12);
      }
    },
  };
}

// Frozen copy of a character's current pose, for dash afterimages
export function freezePose(model) {
  const g = cloneSkinned(model.body);
  g.position.copy(model.root.position);
  g.rotation.y = model.root.rotation.y;
  g.updateMatrixWorld(true);
  return g;
}
