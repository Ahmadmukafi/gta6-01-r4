// DUSTLINE — vehicles.js
// Arcade car physics and traffic AI. Every car is a simple state machine:
// the player's car (arcade handling, drift, dust kick) and traffic cars
// that cruise the street grid, turn at intersections and slow for cars ahead.

import { clamp, wrapAngle, dist2d } from './math3.js';
import { resolveBuildingCollision, nearestStreetPoint } from './world.js';
import { makeRng, range, pick } from './rng.js';

export const CAR_COLORS = [
  { key: 'rust', color: [0.62, 0.25, 0.15] },
  { key: 'teal', color: [0.15, 0.5, 0.5] },
  { key: 'cream', color: [0.85, 0.78, 0.6] },
  { key: 'blue', color: [0.2, 0.3, 0.6] },
  { key: 'yellow', color: [0.85, 0.65, 0.15] },
  { key: 'green', color: [0.25, 0.45, 0.2] },
  { key: 'pink', color: [0.75, 0.4, 0.5] },
  { key: 'grey', color: [0.45, 0.45, 0.48] },
];
export const POLICE_COLOR = { key: 'police', color: [0.12, 0.14, 0.2] };

// A car: x, z, heading (radians, 0 = facing -z), speed (m/s forward),
// plus visual pitch for acceleration squat.
export function makeCar(x, z, heading, colorKey, color) {
  return {
    x, z, heading, speed: 0, y: 0, pitch: 0,
    steer: 0, key: colorKey, color,
    // dust-kick state
    dustCharges: 3, dustTimer: 0,
    // traffic AI
    ai: null, // { dir: 'ns'|'ew', lane: 1|-1, targetSpeed, turnAt }
    crashed: 0, // seconds of crash slowdown
  };
}

// --- player car physics ----------------------------------------------------
export function driveCar(car, input, dt, buildings) {
  const maxSpeed = 42; // ~150 km/h
  const maxReverse = 12;
  let accel = 0;
  if (input.up) accel = 26;
  if (input.down) accel = car.speed > 0.5 ? -34 : -14;
  if (input.handbrake) accel *= 0.35;
  car.speed += accel * dt;
  // Drag + rolling resistance.
  car.speed -= car.speed * (0.35 + (input.handbrake ? 1.6 : 0)) * dt;
  if (!input.up && !input.down) car.speed -= car.speed * 0.6 * dt;
  car.speed = clamp(car.speed, -maxReverse, maxSpeed);
  if (Math.abs(car.speed) < 0.05 && !input.up && !input.down) car.speed = 0;
  // Steering: stronger at low speed, reversed in reverse, drifty on handbrake.
  const steerTarget = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  car.steer += (steerTarget - car.steer) * Math.min(1, dt * 8);
  const grip = input.handbrake ? 2.6 : 1.5;
  const turnRate = car.steer * grip * clamp(Math.abs(car.speed) / 9, 0, 1) * (car.speed < 0 ? -1 : 1);
  car.heading += turnRate * dt;
  const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
  const prevX = car.x, prevZ = car.z;
  car.x += fx * car.speed * dt;
  car.z += fz * car.speed * dt;
  // Buildings block the car.
  const before = { x: car.x, z: car.z };
  const hit = resolveBuildingCollision(buildings, before, 1.6);
  if (hit) {
    const moved = dist2d(prevX, prevZ, before.x, before.z);
    const wanted = dist2d(0, 0, fx * car.speed * dt, fz * car.speed * dt);
    if (wanted > 0.01 && moved < wanted * 0.5 && Math.abs(car.speed) > 6) {
      car.crashed = 0.4; // jolt
    }
    car.x = before.x; car.z = before.z;
    car.speed *= 0.55;
  }
  // Keep inside the playfield.
  car.x = clamp(car.x, -375, 375);
  car.z = clamp(car.z, -375, 375);
  // Visual pitch: nose up on accel, down on brake.
  const targetPitch = clamp(-accel * 0.004, -0.06, 0.06);
  car.pitch += (targetPitch - car.pitch) * Math.min(1, dt * 6);
  if (car.crashed > 0) car.crashed -= dt;
  return hit;
}

// --- traffic AI ------------------------------------------------------------
export function makeTraffic(layout, count) {
  const rng = makeRng(777);
  const cars = [];
  const streets = layout.streets.filter((s) => !s.highway);
  for (let i = 0; i < count; i++) {
    const s = pick(rng, streets);
    const vertical = (s.x1 - s.x0) < (s.z1 - s.z0);
    let x, z, heading;
    if (vertical) {
      x = (s.x0 + s.x1) / 2 + (rng() > 0.5 ? 3.2 : -3.2);
      z = range(rng, -310, 310);
      heading = x > (s.x0 + s.x1) / 2 ? Math.PI : 0; // right-hand lanes
    } else {
      z = (s.z0 + s.z1) / 2 + (rng() > 0.5 ? 3.2 : -3.2);
      x = range(rng, -310, 310);
      heading = z > (s.z0 + s.z1) / 2 ? -Math.PI / 2 : Math.PI / 2;
    }
    const c = pick(rng, CAR_COLORS);
    const car = makeCar(x, z, heading, c.key, c.color);
    car.speed = range(rng, 7, 11);
    car.ai = {
      vertical, lane: rng() > 0.5 ? 1 : -1,
      targetSpeed: car.speed,
      nextTurn: range(rng, 2, 20),
    };
    cars.push(car);
  }
  return cars;
}

export function updateTraffic(cars, layout, dt, allCars) {
  const streets = layout.streets;
  for (const car of cars) {
    const ai = car.ai;
    if (!ai) continue;
    // Slow down if another car is close ahead.
    let blocked = false;
    for (const other of allCars) {
      if (other === car) continue;
      const dx = other.x - car.x, dz = other.z - car.z;
      const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < 11 && side < 3.2) { blocked = true; break; }
    }
    const target = blocked ? 0 : ai.targetSpeed;
    car.speed += (target - car.speed) * Math.min(1, dt * 1.5);
    const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
    car.x += fx * car.speed * dt;
    car.z += fz * car.speed * dt;
    // At an intersection, sometimes turn 90 degrees.
    ai.nextTurn -= dt;
    const nearCross = Math.abs(car.x) < 8 || Math.abs(car.z) < 8 ||
      Math.abs(Math.abs(car.x) - 120) < 8 || Math.abs(Math.abs(car.x) - 240) < 8 ||
      Math.abs(Math.abs(car.z) - 120) < 8 || Math.abs(Math.abs(car.z) - 240) < 8;
    if (ai.nextTurn <= 0 && nearCross && Math.random() < 0.5) {
      car.heading += (Math.random() > 0.5 ? 1 : -1) * Math.PI / 2;
      ai.nextTurn = range(Math.random, 6, 18);
    }
    // Wrap around the ring road if they drift too far out.
    if (Math.abs(car.x) > 340 || Math.abs(car.z) > 340) {
      const p = nearestStreetPoint(streets, 0, 0);
      void p;
      car.x = clamp(car.x, -330, 330);
      car.z = clamp(car.z, -330, 330);
      car.heading = wrapAngle(car.heading + Math.PI);
    }
    resolveBuildingCollision(layout.buildings, car, 1.6);
  }
}

// Distance check: is this car close enough to steal (player on foot)?
export function nearestCar(cars, x, z, maxDist = 4) {
  let best = null, bestD = maxDist;
  for (const c of cars) {
    const d = dist2d(x, z, c.x, c.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
