// DUSTLINE — police.js
// The wanted system and the Dustline County Sheriff's Department.
// Heat 1–5: more cruisers, faster, meaner. Cops chase, ram, and on foot
// they close in and try to bust you. Break line of sight, outrun them,
// hide in a sandstorm — or kick dust in their faces (DUST KICK, Q).

import { clamp, wrapAngle, dist2d } from './math3.js';
import { resolveBuildingCollision } from './world.js';
import { makeCar, POLICE_COLOR } from './vehicles.js';
import { makeRng, range } from './rng.js';

export const MAX_WANTED = 5;

// How many cruisers hunt you at each heat level.
export function cruisersForWanted(w) {
  return [0, 1, 2, 3, 4, 5][clamp(w, 0, 5)];
}

export function makePolice() {
  return {
    wanted: 0,
    heat: 0, // 0..100, fills while committing crimes, drains while hidden
    cruisers: [],
    losTimer: 0, // seconds since any cruiser last saw the player
    escapeTimer: 0, // seconds hidden in a row; at 6 the heat clears
    bustTimer: 0,
    rng: makeRng(99),
  };
}

export function addHeat(police, amount) {
  police.heat = clamp(police.heat + amount, 0, 100);
  const w = police.heat <= 0 ? 0 : police.heat < 25 ? 1 : police.heat < 45 ? 2 : police.heat < 65 ? 3 : police.heat < 85 ? 4 : 5;
  if (w !== police.wanted) police.wanted = w;
}

export function clearHeat(police) {
  police.heat = 0;
  police.wanted = 0;
  police.escapeTimer = 0;
}

// Spawn a cruiser at the edge of town, heading toward the player.
function spawnCruiser(police, playerX, playerZ) {
  const a = police.rng() * Math.PI * 2;
  const r = 120 + police.rng() * 60;
  const x = clamp(playerX + Math.cos(a) * r, -340, 340);
  const z = clamp(playerZ + Math.sin(a) * r, -340, 340);
  const car = makeCar(x, z, Math.atan2(-(playerX - x), -(playerZ - z)), POLICE_COLOR.key, POLICE_COLOR.color);
  car.speed = 20;
  car.ai = { police: true };
  car.siren = 0;
  police.cruisers.push(car);
  return car;
}

// A cruiser is "blinded" for a while after eating a dust kick.
export function blindCruiser(car, seconds) {
  car.blindTimer = Math.max(car.blindTimer || 0, seconds);
}

// Main update. Returns events: { busted: bool, escaped: bool }.
export function updatePolice(police, dt, player, playerCar, buildings, dustClouds, storm) {
  const events = { busted: false, escaped: false };
  const px = playerCar ? playerCar.x : player.x;
  const pz = playerCar ? playerCar.z : player.z;
  const playerSpeed = playerCar ? Math.abs(playerCar.speed) : player.speed;

  // Keep the cruiser count matched to the wanted level.
  const want = cruisersForWanted(police.wanted);
  while (police.cruisers.length < want) spawnCruiser(police, px, pz);
  while (police.cruisers.length > want) police.cruisers.pop();

  // Line of sight: any cruiser within 90 m with a clear-ish view sees you.
  // Dust clouds and the sandstorm break it.
  let seen = false;
  const inStorm = storm && storm.active && dist2d(px, pz, storm.x, storm.z) < storm.r;
  for (const c of police.cruisers) {
    const d = dist2d(c.x, c.z, px, pz);
    const inDust = dustClouds.some((dc) => dist2d(c.x, c.z, dc.x, dc.z) < dc.r);
    c.seesPlayer = d < 95 && !inDust && !inStorm && !(c.blindTimer > 0);
    if (c.seesPlayer) seen = true;
  }
  if (seen) {
    police.losTimer = 0;
    police.escapeTimer = 0;
  } else {
    police.losTimer += dt;
    if (police.wanted > 0) {
      police.escapeTimer += dt;
      // Hiding in the storm clears heat twice as fast.
      if (inStorm) police.escapeTimer += dt;
      if (police.escapeTimer > 6) {
        clearHeat(police);
        events.escaped = true;
      }
    }
  }

  // Cruiser behaviour: chase the player's last known spot, ram the car,
  // or on foot close in for the bust.
  for (const c of police.cruisers) {
    if (c.blindTimer > 0) {
      c.blindTimer -= dt;
      // Blinded cruisers crawl and weave.
      c.speed = Math.max(2, c.speed - 14 * dt);
      c.heading += Math.sin(performance.now() / 300 + c.x) * 0.6 * dt;
    } else {
      const targetSpeed = 16 + police.wanted * 3.2;
      const d = dist2d(c.x, c.z, px, pz);
      const desired = Math.atan2(-(px - c.x), -(pz - c.z));
      const turn = wrapAngle(desired - c.heading);
      c.heading += clamp(turn, -2.4 * dt, 2.4 * dt);
      // Ram: full speed when close and lined up; ease off when very close
      // so they don't overshoot forever.
      const want2 = d > 6 ? targetSpeed : targetSpeed * 0.55;
      c.speed += (want2 - c.speed) * Math.min(1, dt * 1.2);
    }
    const fx = -Math.sin(c.heading), fz = -Math.cos(c.heading);
    c.x += fx * c.speed * dt;
    c.z += fz * c.speed * dt;
    c.x = clamp(c.x, -375, 375);
    c.z = clamp(c.z, -375, 375);
    resolveBuildingCollision(buildings, c, 1.6);
    // Ramming the player's car.
    if (playerCar) {
      const d = dist2d(c.x, c.z, playerCar.x, playerCar.z);
      if (d < 3.4 && c.speed > 6) {
        playerCar.speed *= 0.82;
        c.speed *= 0.7;
        c.crashed = 0.3;
      }
    }
    // On foot: a cruiser that stops next to you starts the bust.
    if (!playerCar) {
      const d = dist2d(c.x, c.z, player.x, player.z);
      if (d < 3 && Math.abs(player.speed) < 1.5) {
        police.bustTimer += dt;
        player.busted = police.bustTimer;
        if (police.bustTimer > 2.2) {
          events.busted = true;
          police.bustTimer = 0;
        }
      } else {
        police.bustTimer = Math.max(0, police.bustTimer - dt * 2);
        player.busted = 0;
      }
    }
  }
  return events;
}

// The sandstorm: a slow wall of dust that rolls across the map.
// It hides you (heat drains) but blinds everyone inside it.
export function makeStorm() {
  return {
    active: false,
    x: -400, z: 0, r: 130,
    vx: 14, // drifts east, wraps around
    nextIn: 45, // seconds until the next storm
    strength: 0, // 0..1, ramps in/out
  };
}

export function updateStorm(storm, dt, time) {
  if (!storm.active) {
    storm.nextIn -= dt;
    if (storm.nextIn <= 0) {
      storm.active = true;
      storm.x = -420;
      storm.z = (Math.sin(time * 0.05) * 120);
      storm.strength = 0;
    }
    return;
  }
  storm.strength = Math.min(1, storm.strength + dt * 0.25);
  storm.x += storm.vx * dt;
  if (storm.x > 480) {
    storm.active = false;
    storm.strength = 0;
    storm.nextIn = 55 + Math.random() * 40;
  }
}

// Ambient dust motes drifting in the wind, for atmosphere.
export function stormParticles(storm, time, out) {
  if (!storm.active || storm.strength < 0.05) return;
  const n = Math.floor(90 * storm.strength);
  for (let i = 0; i < n; i++) {
    const a = (i * 137.5 + time * 12) % 360;
    const r = Math.sqrt(((i * 73) % 100) / 100) * storm.r;
    const x = storm.x + Math.cos(a) * r;
    const z = storm.z + Math.sin(a) * r;
    out.push({
      x, y: 1 + ((i * 37) % 100) / 100 * 14,
      z, size: 6 + ((i * 53) % 100) / 100 * 10,
      alpha: 0.10 + storm.strength * 0.16,
    });
  }
}
