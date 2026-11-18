// DUSTLINE — player.js
// Rook on foot: WASD movement, running, jumping, punching and a six-shot
// revolver (mouse click to fire, hitscan with a tracer). Getting in and out
// of cars with E. Getting shot or busted ends the run.

import { clamp, wrapAngle, dist2d } from './math3.js';
import { resolveBuildingCollision } from './world.js';

export function makePlayer(x, z) {
  return {
    x, z, heading: 0, speed: 0,
    health: 100, money: 0,
    inCar: null, // the car object when driving, else null
    vy: 0, y: 0, // jump
    punchTimer: 0, shootTimer: 0, ammo: 6, reloadTimer: 0,
    busted: 0, // seconds being held by police
    dead: false,
    moving: false,
  };
}

// On-foot update. input: {up,down,left,right,run,jump,punch,shoot,mouseX,mouseY}
// cameraYaw: the camera's yaw, so WASD moves relative to the view.
export function updateOnFoot(player, input, dt, buildings, cameraYaw, onShoot) {
  if (player.dead) return;
  // Face the mouse: heading follows the pointer direction on screen.
  // Simpler and reliable: face movement direction; shooting fires toward
  // the camera-forward ground point.
  let mx = 0, mz = 0;
  const fwd = [-Math.sin(cameraYaw), -Math.cos(cameraYaw)];
  const right = [-fwd[1], fwd[0]];
  if (input.up) { mx += fwd[0]; mz += fwd[1]; }
  if (input.down) { mx -= fwd[0]; mz -= fwd[1]; }
  if (input.right) { mx += right[0]; mz += right[1]; }
  if (input.left) { mx -= right[0]; mz -= right[1]; }
  const len = Math.hypot(mx, mz);
  player.moving = len > 0.01;
  const speed = input.run ? 9.5 : 5.2;
  if (player.moving) {
    mx /= len; mz /= len;
    player.heading = Math.atan2(-mx, -mz);
    const prev = { x: player.x, z: player.z };
    player.x += mx * speed * dt;
    player.z += mz * speed * dt;
    resolveBuildingCollision(buildings, player, 0.6);
    player.speed = speed;
    void prev;
  } else {
    player.speed = 0;
  }
  // Jump.
  if (input.jump && player.y === 0) player.vy = 7;
  if (player.y > 0 || player.vy !== 0) {
    player.vy -= 22 * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) { player.y = 0; player.vy = 0; }
  }
  // Punch.
  if (player.punchTimer > 0) player.punchTimer -= dt;
  // Revolver: 6 shots, then a reload.
  if (player.reloadTimer > 0) {
    player.reloadTimer -= dt;
    if (player.reloadTimer <= 0) player.ammo = 6;
  }
  if (player.shootTimer > 0) player.shootTimer -= dt;
  if (input.shoot && player.shootTimer <= 0 && player.reloadTimer <= 0 && player.ammo > 0) {
    player.shootTimer = 0.32;
    player.ammo -= 1;
    if (player.ammo === 0) player.reloadTimer = 1.6;
    if (onShoot) onShoot(player);
  }
  if (player.busted > 0) player.busted -= dt;
}

// Enter / exit a car. Returns the car entered or null.
export function tryEnterCar(player, cars) {
  if (player.inCar) return null;
  let best = null, bestD = 4.5;
  for (const c of cars) {
    const d = dist2d(player.x, player.z, c.x, c.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best) {
    player.inCar = best;
    best.speed = 0;
  }
  return best;
}

export function exitCar(player) {
  const car = player.inCar;
  if (!car) return;
  player.inCar = null;
  // Step out to the car's left side.
  const sideX = Math.cos(car.heading);
  const sideZ = -Math.sin(car.heading);
  player.x = car.x + sideX * 2.2;
  player.z = car.z + sideZ * 2.2;
  player.heading = car.heading;
}

// Damage the player; returns true if it killed them.
export function hurtPlayer(player, dmg) {
  if (player.dead) return true;
  player.health = clamp(player.health - dmg, 0, 100);
  if (player.health <= 0) {
    player.dead = true;
    return true;
  }
  return false;
}

export function healPlayer(player, amount) {
  player.health = clamp(player.health + amount, 0, 100);
}
