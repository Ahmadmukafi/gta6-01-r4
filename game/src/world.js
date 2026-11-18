// DUSTLINE — world.js
// The city itself: Dustline City, a sun-baked desert boomtown on the edge of
// the dunes. A street grid, a ring highway, an airstrip, and landmarks with
// the town's own names. All layout is generated once from a fixed seed so
// every run sees the same town.

import { makeRng, range, pick, intRange } from './rng.js';

export const WORLD = {
  half: 380,        // playfield half-size in metres
  streetW: 14,      // street width
  block: 60,        // block size
  gridN: 5,         // streets each way (at -240,-120,0,120,240)
};

// Build the full layout. Returns streets, buildings, props, landmarks,
// spawn points and the named places missions use.
export function buildWorld() {
  const rng = makeRng(20261119);
  const streets = [];
  const coords = [-240, -120, 0, 120, 240];
  // North-south and east-west streets.
  for (const c of coords) {
    streets.push({ x0: c - WORLD.streetW / 2, x1: c + WORLD.streetW / 2, z0: -330, z1: 330, highway: false });
    streets.push({ x0: -330, x1: 330, z0: c - WORLD.streetW / 2, z1: c + WORLD.streetW / 2, highway: false });
  }
  // Main drag: Mirage Boulevard, wider, north-south through the centre.
  streets.push({ x0: -11, x1: 11, z0: -330, z1: 330, highway: false, main: true });
  // Ring highway around the town.
  const R = 330;
  streets.push({ x0: -R - 9, x1: -R + 9, z0: -R, z1: R, highway: true });
  streets.push({ x0: R - 9, x1: R + 9, z0: -R, z1: R, highway: true });
  streets.push({ x0: -R, x1: R, z0: -R - 9, z1: -R + 9, highway: true });
  streets.push({ x0: -R, x1: R, z0: R - 9, z1: R + 9, highway: true });

  // Buildings: fill the blocks between streets. Downtown towers near centre,
  // low adobe and motels further out. Each building is an AABB collider.
  const buildings = [];
  const palette = [
    [0.72, 0.55, 0.38], [0.66, 0.44, 0.25], [0.79, 0.63, 0.42],
    [0.56, 0.42, 0.29], [0.48, 0.38, 0.42], [0.62, 0.52, 0.36],
  ];
  for (let gx = 0; gx < 4; gx++) {
    for (let gz = 0; gz < 4; gz++) {
      // Block corners: streets at -240,-120,0,120,240; blocks sit between them.
      const bx0 = -240 + gx * 120 + 12;
      const bz0 = -240 + gz * 120 + 12;
      const bx1 = bx0 + 96;
      const bz1 = bz0 + 96;
      const distC = Math.hypot((bx0 + bx1) / 2, (bz0 + bz1) / 2);
      const downtown = distC < 150;
      const count = downtown ? intRange(rng, 3, 4) : intRange(rng, 1, 3);
      for (let i = 0; i < count; i++) {
        const w = range(rng, 18, 34);
        const d = range(rng, 18, 34);
        const x = range(rng, bx0 + w / 2, bx1 - w / 2);
        const z = range(rng, bz0 + d / 2, bz1 - d / 2);
        let h;
        if (downtown) h = range(rng, 22, 58);
        else h = range(rng, 7, 18);
        // Keep the casino plot and the diner plot clear (landmarks below).
        if (Math.abs(x - 60) < 40 && Math.abs(z + 60) < 40) continue;
        if (Math.abs(x + 90) < 34 && Math.abs(z - 90) < 34) continue;
        buildings.push({
          x, z, w, d, h,
          color: pick(rng, palette),
          facade: intRange(rng, 0, 3),
          rot: rng() > 0.85 ? Math.PI / 2 : 0,
        });
      }
    }
  }

  // Landmarks — the named places missions use.
  const landmarks = {
    casino: { name: 'The Mirage Casino', x: 60, z: -60, w: 56, d: 40, h: 26, color: [0.45, 0.2, 0.28], facade: 1 },
    motel: { name: 'Saguaro Motel', x: -180, z: 60, w: 44, d: 20, h: 10, color: [0.55, 0.62, 0.5], facade: 2 },
    diner: { name: 'Dusty Spur Diner', x: -90, z: 90, w: 30, d: 22, h: 9, color: [0.75, 0.6, 0.4], facade: 0 },
    gas: { name: 'Gas-O-Line', x: 180, z: 180, w: 26, d: 20, h: 7, color: [0.7, 0.28, 0.2], facade: 3 },
    theater: { name: 'Starlite Drive-In', x: -180, z: -180, w: 40, d: 8, h: 16, color: [0.35, 0.35, 0.42], facade: 1 },
    airstrip: { name: 'Dustline Airfield', x: 330, z: 0, w: 60, d: 280, h: 0, color: [0.6, 0.55, 0.45], facade: 0 },
    watertower: { name: 'Water Tower', x: -60, z: -180, w: 10, d: 10, h: 34, color: [0.6, 0.6, 0.58], facade: 0 },
  };
  for (const key of ['casino', 'motel', 'diner', 'gas', 'theater']) {
    buildings.push({ ...landmarks[key], landmark: key });
  }

  // Props: cacti, palms, billboards, street lamps, dunes.
  const props = [];
  // Cacti out in the desert and along sidewalks.
  for (let i = 0; i < 130; i++) {
    const a = rng() * Math.PI * 2;
    const r = 260 + rng() * 110;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 345 && Math.abs(z) < 345) continue;
    props.push({ kind: 'cactus', x, z, s: range(rng, 0.8, 1.8) });
  }
  for (let i = 0; i < 40; i++) {
    props.push({
      kind: 'cactus',
      x: pick(rng, coords) + (rng() > 0.5 ? 10 : -10) + range(rng, -2, 2),
      z: range(rng, -300, 300),
      s: range(rng, 0.7, 1.3),
    });
  }
  // Dunes: low mounds ringing the town. The airstrip stays clear — no dune
  // may sit on the runway or its approach (x 285..375, z -150..150).
  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2;
    const r = 300 + rng() * 70;
    const dx = Math.cos(a) * r;
    const dz = Math.sin(a) * r;
    if (dx > 285 && dx < 375 && Math.abs(dz) < 150) continue;
    props.push({ kind: 'dune', x: dx, z: dz, s: range(rng, 18, 42) });
  }
  // Palm rows down Mirage Boulevard.
  for (let z = -280; z <= 280; z += 40) {
    props.push({ kind: 'palm', x: -14, z, s: 1 });
    props.push({ kind: 'palm', x: 14, z: z + 20, s: 1 });
  }
  // Billboards.
  props.push({ kind: 'billboard', x: -24, z: -260, rot: 0, lines: ['THE MIRAGE', 'SLOTS · SHOWS · STEAKS'], bg: '#5d1f2a', fg: '#ffd98a', accent: '#ffb347' });
  props.push({ kind: 'billboard', x: 260, z: 24, rot: Math.PI / 2, lines: ['GAS-O-LINE', 'CHEAPEST GAS IN THE COUNTY'], bg: '#1f3a5d', fg: '#f5f0e0', accent: '#ff6b4a' });
  props.push({ kind: 'billboard', x: 24, z: 260, rot: Math.PI, lines: ['STARLITE DRIVE-IN', 'TONIGHT: DUST & THUNDER'], bg: '#2a2a33', fg: '#ffe9b0', accent: '#7ad0ff' });
  // Street lamps along the main drag.
  for (let z = -300; z <= 300; z += 60) {
    props.push({ kind: 'lamp', x: -13, z, s: 1 });
    props.push({ kind: 'lamp', x: 13, z: z + 30, s: 1 });
  }
  // Water tower (built as a prop so it is not a building collider).
  props.push({ kind: 'watertower', x: landmarks.watertower.x, z: landmarks.watertower.z, s: 1 });

  // Named spots the game uses.
  const spots = {
    playerStart: { x: 0, z: 60 },
    carStart: { x: 3.5, z: 60 },
    motelPickup: { x: -180, z: 36 },
    dinerDrop: { x: -90, z: 66 },
    gasRefill: { x: 180, z: 156 },
    casinoValet: { x: 60, z: -16 },
    chopShop: { x: -240, z: -180 },
    airstripEnd: { x: 330, z: 0 },
    theaterMeet: { x: -180, z: -156 },
  };

  return { streets, buildings, props, landmarks, spots };
}

// Is a point inside any building AABB (with a margin)? Used for collisions.
export function insideBuilding(buildings, x, z, margin = 0) {
  for (const b of buildings) {
    if (b.h <= 0) continue;
    if (Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin) return b;
  }
  return null;
}

// Push a circle (x, z, radius) out of every building it overlaps.
export function resolveBuildingCollision(buildings, pos, radius) {
  let hit = false;
  for (const b of buildings) {
    if (b.h <= 0) continue;
    const cx = Math.max(b.x - b.w / 2, Math.min(pos.x, b.x + b.w / 2));
    const cz = Math.max(b.z - b.d / 2, Math.min(pos.z, b.z + b.d / 2));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const px = b.w / 2 + radius - Math.abs(pos.x - b.x);
        const pz = b.d / 2 + radius - Math.abs(pos.z - b.z);
        if (px < pz) pos.x = b.x + (pos.x > b.x ? 1 : -1) * (b.w / 2 + radius);
        else pos.z = b.z + (pos.z > b.z ? 1 : -1) * (b.d / 2 + radius);
      }
    }
  }
  return hit;
}

// Nearest point on the street network to (x, z), for traffic AI.
export function nearestStreetPoint(streets, x, z) {
  let best = null, bestD = Infinity;
  for (const s of streets) {
    const cx = Math.max(s.x0, Math.min(x, s.x1));
    const cz = Math.max(s.z0, Math.min(z, s.z1));
    const d = Math.hypot(x - cx, z - cz);
    if (d < bestD) { bestD = d; best = { x: cx, z: cz, street: s }; }
  }
  return best;
}
