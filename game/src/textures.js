// DUSTLINE — textures.js
// Every texture is drawn at runtime on a canvas: no image files, no network.
// The city reads as a sun-baked desert town — sand, asphalt, adobe, neon signs.

import { makeRng, range, pick } from './rng.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Ground texture: 1024x1024 covering the whole 760 m playfield.
// Sand base, darker desert patches, the street grid, sidewalks, lane dashes,
// the ring highway and a dusty airstrip on the east edge.
export function makeGroundTexture(layout) {
  const [c, g] = makeCanvas(1024, 1024);
  const S = 1024;
  const world = 760; // metres across the texture
  const toPx = (m) => ((m + world / 2) / world) * S;

  // Sand base.
  g.fillStyle = '#c98f4e';
  g.fillRect(0, 0, S, S);
  const rng = makeRng(1337);
  // Desert mottling.
  for (let i = 0; i < 2600; i++) {
    const x = rng() * S, y = rng() * S, r = 2 + rng() * 14;
    g.fillStyle = pick(rng, ['#b87f42', '#d9a35f', '#a9743a', '#dca964']);
    g.globalAlpha = 0.12 + rng() * 0.2;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // Dry scrub patches far from the streets.
  for (let i = 0; i < 90; i++) {
    const x = rng() * S, y = rng() * S;
    g.fillStyle = '#8a6b35';
    g.globalAlpha = 0.25;
    g.beginPath();
    g.arc(x, y, 3 + rng() * 6, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // Airstrip (east edge): pale concrete strip + runway marks.
  const ax0 = toPx(300), ax1 = toPx(360), az0 = toPx(-140), az1 = toPx(140);
  g.fillStyle = '#9a8d7a';
  g.fillRect(ax0, az0, ax1 - ax0, az1 - az0);
  g.fillStyle = '#f5f0e0';
  for (let z = -120; z <= 120; z += 30) {
    g.fillRect((ax0 + ax1) / 2 - 3, toPx(z), 6, 16);
  }
  g.fillStyle = '#c23b2a';
  g.font = 'bold 26px sans-serif';
  g.textAlign = 'center';
  g.fillText('DUSTLINE AIRFIELD', (ax0 + ax1) / 2, toPx(160));

  // Streets: dark asphalt with lighter sidewalks.
  for (const s of layout.streets) {
    const x0 = toPx(s.x0), x1 = toPx(s.x1), z0 = toPx(s.z0), z1 = toPx(s.z1);
    const w = Math.abs(x1 - x0), h = Math.abs(z1 - z0);
    g.fillStyle = '#8d8578'; // sidewalk border
    g.fillRect(Math.min(x0, x1) - 3, Math.min(z0, z1) - 3, w + 6, h + 6);
    g.fillStyle = s.highway ? '#3d3a38' : '#4a4642'; // asphalt
    g.fillRect(Math.min(x0, x1), Math.min(z0, z1), w, h);
    // Centre dashes.
    g.fillStyle = '#d8c84a';
    if (w > h) {
      for (let x = Math.min(x0, x1) + 6; x < Math.max(x0, x1) - 6; x += 14) {
        g.fillRect(x, (z0 + z1) / 2 - 1, 8, 2);
      }
    } else {
      for (let z = Math.min(z0, z1) + 6; z < Math.max(z0, z1) - 6; z += 14) {
        g.fillRect((x0 + x1) / 2 - 1, z, 2, 8);
      }
    }
  }

  // Crosswalks at the central intersection.
  g.fillStyle = '#e8e4da';
  const cx = toPx(0), cz = toPx(0);
  for (let i = -3; i <= 3; i++) {
    g.fillRect(cx - 22 + i * 7, cz - 12, 4, 24);
  }
  return c;
}

// Facade atlas: 4 facade patterns side by side in a 512x128 canvas.
// Each pattern: lit windows on a tinted wall. Buildings sample one column.
export function makeFacadeAtlas() {
  const [c, g] = makeCanvas(512, 128);
  const rng = makeRng(4242);
  const tints = ['#b98a5e', '#a8703f', '#c9a06a', '#8f6b4a'];
  const lit = ['#ffd98a', '#ffe9b0', '#ffbf5e'];
  for (let col = 0; col < 4; col++) {
    const x0 = col * 128;
    g.fillStyle = tints[col];
    g.fillRect(x0, 0, 128, 128);
    // Stucco noise.
    for (let i = 0; i < 200; i++) {
      g.fillStyle = rng() > 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
      g.fillRect(x0 + rng() * 128, rng() * 128, 3, 3);
    }
    // Window grid.
    for (let row = 0; row < 5; row++) {
      for (let col2 = 0; col2 < 4; col2++) {
        const wx = x0 + 12 + col2 * 28;
        const wy = 10 + row * 22;
        const litWin = rng() > 0.45;
        g.fillStyle = litWin ? pick(rng, lit) : '#2c2118';
        g.fillRect(wx, wy, 16, 14);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(wx, wy + 12, 16, 2);
      }
    }
    // Ground-floor awning stripe.
    g.fillStyle = pick(rng, ['#7a3b2e', '#2e5d4b', '#31456b', '#8a6d1f']);
    g.fillRect(x0, 108, 128, 20);
  }
  return c;
}

// Billboard faces: painted signs with the town's own names.
export function makeBillboardTexture(lines, bg, fg, accent) {
  const [c, g] = makeCanvas(512, 256);
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = accent;
  g.lineWidth = 10;
  g.strokeRect(8, 8, 496, 240);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((line, i) => {
    const size = i === 0 ? 72 : 44;
    g.font = `bold ${size}px Georgia, serif`;
    g.fillText(line, 256, 256 * ((i + 1) / (n + 1)));
  });
  return c;
}

// Soft round sprite for dust particles.
export function makeDustSprite() {
  const [c, g] = makeCanvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(214,178,120,0.85)');
  grad.addColorStop(0.6, 'rgba(200,160,100,0.35)');
  grad.addColorStop(1, 'rgba(200,160,100,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

// Small white 1x1 texture used for untextured coloured geometry.
export function makeWhiteTexture() {
  const [c, g] = makeCanvas(2, 2);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 2, 2);
  return c;
}
