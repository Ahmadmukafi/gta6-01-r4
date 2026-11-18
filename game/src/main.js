// DUSTLINE — main.js
// The game loop and wiring: input, chase camera, dust-kick clouds, shooting,
// traffic, pedestrians, police, missions, HUD, save/load, screenshot mode.
// One file, one job: make all the systems play together.

import { Renderer } from './render.js';
import { buildWorld, resolveBuildingCollision } from './world.js';
import { makeRng, range, pick } from './rng.js';
import { DustAudio } from './audio.js';
import { Hud } from './hud.js';
import { makeCar, makeTraffic, driveCar, updateTraffic, CAR_COLORS } from './vehicles.js';
import { makePlayer, updateOnFoot, tryEnterCar, exitCar, hurtPlayer } from './player.js';
import { makePolice, addHeat, updatePolice, makeStorm, updateStorm, stormParticles, blindCruiser } from './police.js';
import { makeMissionState, startMission, updateMissions, activeMarker, missionProgressText, currentMission } from './missions.js';
import { applyShot } from './shots.js';
import { clamp, dist2d, m4perspective, m4lookAt } from './math3.js';

const SAVE_KEY = 'dustline-save-v1';

class DustGame {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas);
    this.layout = buildWorld();
    this.renderer.initTextures(this.layout);
    this.renderer.buildStatic(this.layout);
    this.audio = new DustAudio();
    this.hud = new Hud(document.getElementById('hud'));
    this.player = makePlayer(this.layout.spots.playerStart.x, this.layout.spots.playerStart.z);
    this.playerCar = makeCar(this.layout.spots.carStart.x, this.layout.spots.carStart.z, 0, 'rust', [0.62, 0.25, 0.15]);
    this.traffic = makeTraffic(this.layout, 14);
    this.drivable = [this.playerCar, ...this.traffic];
    this.police = makePolice();
    this.storm = makeStorm();
    this.missions = makeMissionState();
    this.peds = this.makePeds(18);
    this.dust = { particles: [], clouds: [] };
    this.input = { up: false, down: false, left: false, right: false, run: false, jump: false, handbrake: false };
    this.camera = { yaw: 0, yawOffset: 0, dist: 12, fixed: null };
    this.state = 'menu';
    this.started = false;
    this.time = 0;
    this.fps = 60;
    this.errors = [];
    this.dustRefill = 0;
    this.shootCooldown = 0;
    this.damageCooldown = 0;
    this.saveTimer = 0;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.shotMode = new URLSearchParams(location.search).get('shot');
    window.addEventListener('error', (e) => this.errors.push(String(e.message || e.error)));
    this.loadSave();
    this.bindInput();
    this.hud.onMenuClick = () => this.startGame();
    this.hud.onEndClick = () => this.retry();
    this.hud.showMenu('DUSTLINE', 'A sun-baked desert town. One getaway driver. Five jobs.', 'START ENGINE');
    this.lastT = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // --- save / load ---------------------------------------------------------
  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.cash === 'number') this.player.money = s.cash;
      if (typeof s.mission === 'number') this._savedMission = Math.max(0, Math.min(4, s.mission));
    } catch (e) { /* fresh start */ }
  }
  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: this.player.money, mission: this.missions.index }));
    } catch (e) { /* storage unavailable */ }
  }

  // --- setup ---------------------------------------------------------------
  makePeds(count) {
    const rng = makeRng(5150);
    const shirts = [[0.7, 0.3, 0.3], [0.3, 0.5, 0.7], [0.85, 0.75, 0.4], [0.4, 0.6, 0.35], [0.8, 0.8, 0.8]];
    const peds = [];
    for (let i = 0; i < count; i++) {
      const s = pick(rng, shirts);
      peds.push({
        x: range(rng, -280, 280), z: range(rng, -280, 280),
        heading: rng() * Math.PI * 2, speed: range(rng, 1.2, 2.2),
        shirt: s, key: 'ped' + i, tx: 0, tz: 0, flee: 0,
      });
      peds[i].tx = peds[i].x; peds[i].tz = peds[i].z;
    }
    return peds;
  }

  bindInput() {
    const keyMap = {
      KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
      ShiftLeft: 'run', ShiftRight: 'run', Space: 'handbrake',
    };
    window.addEventListener('keydown', (e) => {
      if (keyMap[e.code] !== undefined) { this.input[keyMap[e.code]] = true; e.preventDefault(); }
      if (e.code === 'Space') this.input.jump = true;
      if (e.code === 'KeyE') this.toggleCar();
      if (e.code === 'KeyQ') this.dustKick();
      if (e.code === 'KeyP') this.togglePause();
      if (e.code === 'KeyM') this.audio.toggleMute();
      if (e.code === 'KeyR') this.resetCar();
      if (e.code === 'Enter' && this.state === 'menu') this.startGame();
      this.audio.init();
    });
    window.addEventListener('keyup', (e) => {
      if (keyMap[e.code] !== undefined) this.input[keyMap[e.code]] = false;
      if (e.code === 'Space') this.input.jump = false;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.audio.init();
      if (this.state === 'playing' && !this.player.inCar) this.shoot(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.camera.yawOffset += (e.clientX - this.lastX) * 0.005;
      this.camera.dist = clamp(this.camera.dist + (e.clientY - this.lastY) * 0.05, 7, 22);
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    this.canvas.addEventListener('wheel', (e) => {
      this.camera.dist = clamp(this.camera.dist + e.deltaY * 0.01, 7, 22);
      e.preventDefault();
    }, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // --- flow ------------------------------------------------------------------
  startGame() {
    this.audio.init();
    this.audio.startMusic();
    this.started = true;
    this.state = 'playing';
    this.hud.hideMenu();
    this.hud.hideEnd();
    const idx = this._savedMission || 0;
    startMission(this.missions, idx, this.missionHooks());
    this.hud.toast('JOB ' + (idx + 1) + ' — ' + (currentMission(this.missions) || {}).title, 4);
  }

  retry() {
    this.hud.hideEnd();
    this.player.health = 100;
    this.player.dead = false;
    this.player.busted = 0;
    this.police.heat = 0;
    this.police.wanted = 0;
    this.police.cruisers.length = 0;
    this.player.x = this.layout.spots.playerStart.x;
    this.player.z = this.layout.spots.playerStart.z;
    if (this.player.inCar) { this.player.inCar = null; }
    this.playerCar.x = this.layout.spots.carStart.x;
    this.playerCar.z = this.layout.spots.carStart.z;
    this.playerCar.speed = 0;
    this.state = 'playing';
    startMission(this.missions, this.missions.index, this.missionHooks());
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.hud.showPause(true);
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.hud.showPause(false);
    }
  }

  resetCar() {
    const car = this.player.inCar;
    if (!car || Math.abs(car.speed) > 1) return;
    car.x = clamp(car.x, -320, 320);
    car.z = clamp(car.z, -320, 320);
    car.speed = 0;
    this.hud.toast('Car reset');
  }

  missionHooks() {
    return {
      setHeat: (n) => { this.police.heat = [0, 12, 35, 55, 75, 92][n] || 0; this.police.wanted = n; },
      forceStorm: () => { this.storm.active = true; this.storm.strength = 1; this.storm.x = -420; this.storm.z = 0; },
      onReward: (r) => { this.player.money += r; this.save(); },
      onComplete: () => { this.audio.missionSting(true); },
      onStart: (m) => {
        if (m.id === 'mirage-job') {
          // The cream Cordova waits at the Mirage valet.
          const cordova = makeCar(60, -16, Math.PI / 2, 'cream', [0.85, 0.78, 0.6]);
          this.traffic.push(cordova);
          this.drivable.push(cordova);
        }
      },
    };
  }

  toggleCar() {
    if (this.state !== 'playing') return;
    if (this.player.inCar) {
      exitCar(this.player);
      this.audio.blip(300, 0.08, 'square', 0.1);
    } else {
      const car = tryEnterCar(this.player, this.drivable);
      if (car) {
        car.ai = null; // stolen cars stop following traffic routes
        this.audio.blip(500, 0.08, 'square', 0.12);
        if (this.police.wanted === 0 && this.traffic.includes(car)) {
          addHeat(this.police, 12); // stealing a car in the open is a crime
          this.hud.toast('Car stolen! The sheriff noticed.');
        }
      }
    }
  }

  // --- the signature mechanic: DUST KICK ------------------------------------
  dustKick() {
    if (this.state !== 'playing') return;
    const car = this.player.inCar;
    if (car) {
      if (car.dustCharges <= 0) { this.hud.toast('No dust left — refill at Gas-O-Line'); return; }
      car.dustCharges -= 1;
      const bx = car.x + Math.sin(car.heading) * 3;
      const bz = car.z + Math.cos(car.heading) * 3;
      this.spawnDustCloud(bx, bz, 16);
      this.audio.dustWhoosh();
    } else {
      if (this._footDust === undefined) this._footDust = 3;
      if (this._footDust <= 0) { this.hud.toast('No dust left'); return; }
      this._footDust -= 1;
      this.spawnDustCloud(this.player.x, this.player.z, 10);
      this.audio.dustWhoosh();
    }
  }

  spawnDustCloud(x, z, r) {
    this.dust.clouds.push({ x, z, r, life: 4, maxLife: 4 });
    this.burstDust(x, z, 42, r * 0.8, 3);
    // Blind every cruiser caught inside the cloud.
    for (const c of this.police.cruisers) {
      if (dist2d(c.x, c.z, x, z) < r + 4) blindCruiser(c, 4);
    }
  }

  burstDust(x, z, n, spread, up = 2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * spread;
      this.dust.particles.push({
        x: x + Math.cos(a) * d, y: 0.5 + Math.random() * up,
        z: z + Math.sin(a) * d,
        vx: Math.cos(a) * (1 + Math.random() * 2), vy: 0.6 + Math.random() * 1.4,
        vz: Math.sin(a) * (1 + Math.random() * 2),
        life: 1.6 + Math.random() * 1.6, maxLife: 3,
        size: 5 + Math.random() * 7, alpha: 0.5,
      });
    }
  }

  // --- shooting --------------------------------------------------------------
  shoot(e) {
    if (this.player.shootTimer > 0 || this.player.reloadTimer > 0 || this.player.ammo <= 0) return;
    this.player.shootTimer = 0.32;
    this.player.ammo -= 1;
    if (this.player.ammo === 0) this.player.reloadTimer = 1.6;
    this.audio.gunshot();
    // Aim: from the player toward the camera-forward ground point.
    const fx = -Math.sin(this.camera.yaw), fz = -Math.cos(this.camera.yaw);
    const aimX = this.player.x + fx * 30, aimZ = this.player.z + fz * 30;
    // Nearest cruiser near the aim line.
    let best = null, bestD = 60;
    for (const c of this.police.cruisers) {
      const dx = c.x - this.player.x, dz = c.z - this.player.z;
      const along = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (along > 2 && along < bestD && side < 4) { best = c; bestD = along; }
    }
    let hitX = aimX, hitZ = aimZ;
    if (best) {
      hitX = best.x; hitZ = best.z;
      best.disabled = (best.disabled || 0) + 5;
      addHeat(this.police, 10);
      this.hud.toast('Cruiser disabled!');
      this.burstDust(hitX, hitZ, 14, 2, 2);
    } else {
      // Maybe a pedestrian took the bullet.
      for (const p of this.peds) {
        const dx = p.x - this.player.x, dz = p.z - this.player.z;
        const along = dx * fx + dz * fz;
        const side = Math.abs(dx * fz - dz * fx);
        if (along > 2 && along < 40 && side < 2) {
          p.flee = 4;
          hitX = p.x; hitZ = p.z;
          addHeat(this.police, 15);
          this.hud.toast('You shot a pedestrian! The heat is on.');
          break;
        }
      }
    }
    // Tracer: a line of fading dust motes.
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      this.dust.particles.push({
        x: this.player.x + (hitX - this.player.x) * t,
        y: 1.4, z: this.player.z + (hitZ - this.player.z) * t,
        vx: 0, vy: 0, vz: 0, life: 0.25, maxLife: 0.25,
        size: 2.5, alpha: 0.8,
      });
    }
  }

  // --- per-frame ---------------------------------------------------------------
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.lastT) / 1000 || 0.016);
    this.lastT = now;
    this.time += dt;
    this.fps += ((1 / Math.max(dt, 0.001)) - this.fps) * 0.05;
    if (this.state === 'paused') return;
    if (this.state === 'playing') this.update(dt);
    this.render();
  }

  update(dt) {
    const P = this.player;
    const car = P.inCar;
    // --- input -> movement ---
    if (car) {
      const hit = driveCar(car, this.input, dt, this.layout.buildings);
      if (hit && Math.abs(car.speed) > 8) {
        this.audio.crash();
        this.burstDust(car.x, car.z, 10, 2, 1.5);
      }
      P.x = car.x; P.z = car.z; P.heading = car.heading;
      // Tire dust at speed / drift.
      if (Math.abs(car.speed) > 14 && Math.random() < 0.5) {
        this.burstDust(car.x + Math.sin(car.heading) * 2, car.z + Math.cos(car.heading) * 2, 2, 1.5, 0.8);
      }
      // Dust charges refill slowly; instantly at the gas station.
      this.dustRefill += dt;
      if (this.dustRefill > 18) { this.dustRefill = 0; car.dustCharges = Math.min(3, car.dustCharges + 1); }
      if (dist2d(car.x, car.z, this.layout.spots.gasRefill.x, this.layout.spots.gasRefill.z) < 15) {
        if (car.dustCharges < 3) { car.dustCharges = 3; this.hud.toast('Dust refilled at Gas-O-Line'); }
      }
      // Running over a pedestrian.
      for (let i = this.peds.length - 1; i >= 0; i--) {
        const p = this.peds[i];
        if (Math.abs(car.speed) > 5 && dist2d(car.x, car.z, p.x, p.z) < 2.2) {
          this.peds.splice(i, 1);
          addHeat(this.police, 15);
          this.hud.toast('You hit a pedestrian!');
          this.audio.crash();
        }
      }
    } else {
      updateOnFoot(P, {
        up: this.input.up, down: this.input.down, left: this.input.left, right: this.input.right,
        run: this.input.run, jump: this.input.jump, punch: false,
        shoot: false, mouseX: 0, mouseY: 0,
      }, dt, this.layout.buildings, this.camera.yaw, null);
    }
    if (P.shootTimer > 0) P.shootTimer -= dt;

    // --- traffic + pedestrians ---
    updateTraffic(this.traffic, this.layout, dt, this.drivable.concat(this.police.cruisers));
    for (const p of this.peds) {
      if (p.flee > 0) {
        p.flee -= dt;
        const away = Math.atan2(-(p.x - P.x), -(p.z - P.z));
        p.heading = away;
        p.x += -Math.sin(away) * 6 * dt;
        p.z += -Math.cos(away) * 6 * dt;
      } else {
        const d = dist2d(p.x, p.z, p.tx, p.tz);
        if (d < 2) {
          p.tx = clamp(p.x + range(Math.random, -90, 90), -320, 320);
          p.tz = clamp(p.z + range(Math.random, -90, 90), -320, 320);
        }
        p.heading = Math.atan2(-(p.tx - p.x), -(p.tz - p.z));
        p.x += -Math.sin(p.heading) * p.speed * dt;
        p.z += -Math.cos(p.heading) * p.speed * dt;
        resolveBuildingCollision(this.layout.buildings, p, 0.6);
      }
    }

    // --- storm ---
    updateStorm(this.storm, dt, this.time);
    const stormList = [];
    stormParticles(this.storm, this.time, stormList);
    for (const s of stormList) this.dust.particles.push({ ...s, vx: 2, vy: 0.2, vz: 0, life: 2.5, maxLife: 2.5 });

    // --- police ---
    const inStorm = this.storm.active && dist2d(P.x, P.z, this.storm.x, this.storm.z) < this.storm.r;
    const events = updatePolice(this.police, dt, P, car, this.layout.buildings, this.dust.clouds, this.storm);
    if (events.escaped) this.hud.toast('You lost them. The heat is off — for now.');
    // Disabled cruisers (shot) stay put and smoke.
    for (const c of this.police.cruisers) {
      if (c.disabled > 0) {
        c.disabled -= dt;
        c.speed = 0;
        if (Math.random() < 0.4) this.burstDust(c.x, c.z, 1, 1, 2.5);
      }
      // Cruisers shoot back at high heat.
      if (this.police.wanted >= 3 && !c.disabled && dist2d(c.x, c.z, P.x, P.z) < 26) {
        c.shootTimer = (c.shootTimer || 0) - dt;
        if (c.shootTimer <= 0) {
          c.shootTimer = 1.4;
          if (Math.random() < 0.3) {
            hurtPlayer(P, 8);
            this.audio.gunshot();
            this.hud.toast('Taking fire!');
          }
        }
      }
      // Ramming hurts.
      if (car && dist2d(c.x, c.z, car.x, car.z) < 3.4 && c.speed > 6) {
        this.damageCooldown -= dt;
        if (this.damageCooldown <= 0) {
          this.damageCooldown = 1;
          hurtPlayer(P, 4);
        }
      }
    }
    if (events.busted) {
      this.state = 'busted';
      this.hud.showEnd('BUSTED', 'The sheriff caught up with Rook. The car is impounded — but the cash stays. Try again.', 'TRY AGAIN');
      this.audio.missionSting(false);
      return;
    }
    if (P.dead) {
      this.state = 'dead';
      this.hud.showEnd('FLATLINED', 'Rook went down in the dust. Dustline forgets fast — try again.', 'TRY AGAIN');
      this.audio.missionSting(false);
      return;
    }

    // --- missions ---
    const mres = updateMissions(this.missions, {
      playerX: P.x, playerZ: P.z, inCar: !!car, car,
      wanted: this.police.wanted, dt, hooks: this.missionHooks(),
    });
    if (mres === 'mission' || mres === 'objective') this.audio.pickup();
    if (mres === 'alldone') {
      this.state = 'done';
      this.save();
      this.hud.showEnd('THE END — ROOK GOT AWAY', `All five jobs done. $${this.player.money.toLocaleString('en-US')} in the bag, and the plane is waiting.`, 'PLAY AGAIN');
      this.audio.missionSting(true);
      return;
    }

    // --- dust clouds + particles ---
    for (let i = this.dust.clouds.length - 1; i >= 0; i--) {
      const c = this.dust.clouds[i];
      c.life -= dt;
      if (c.life <= 0) { this.dust.clouds.splice(i, 1); continue; }
      if (Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * c.r;
        this.dust.particles.push({
          x: c.x + Math.cos(a) * d, y: 0.5 + Math.random() * 4, z: c.z + Math.sin(a) * d,
          vx: 0, vy: 0.4, vz: 0, life: 1.2, maxLife: 1.2,
          size: 7 + Math.random() * 6, alpha: 0.35,
        });
      }
    }
    for (let i = this.dust.particles.length - 1; i >= 0; i--) {
      const p = this.dust.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.dust.particles.splice(i, 1); continue; }
      p.x += (p.vx || 0) * dt;
      p.y += (p.vy || 0) * dt;
      p.z += (p.vz || 0) * dt;
      p.alpha = Math.min(0.55, (p.life / p.maxLife) * 0.5);
    }
    if (this.dust.particles.length > 650) this.dust.particles.splice(0, this.dust.particles.length - 650);

    // --- audio + HUD ---
    this.audio.update(dt, {
      speed: car ? car.speed : 0, inCar: !!car,
      wanted: this.police.wanted,
      storm: this.storm.active ? this.storm.strength : 0, time: this.time,
    });
    const marker = activeMarker(this.missions);
    this.hud.update({
      cash: this.player.money, wanted: this.police.wanted,
      speedKmh: car ? Math.abs(car.speed) * 3.6 : 0,
      dust: car ? car.dustCharges : (this._footDust ?? 3),
      objective: missionProgressText(this.missions),
      message: this.missions.message,
      messageTimer: this.missions.messageTimer,
      inCar: !!car, health: this.player.health,
      stormAlpha: inStorm ? 0.5 : (this.storm.active ? this.storm.strength * 0.25 : 0),
    }, dt);
    if (this.missions.messageTimer > 0) this.missions.messageTimer -= dt;
    this.hud.drawMinimap(this.layout, {
      storm: this.storm, marker,
      traffic: this.traffic, police: this.police.cruisers,
      playerX: P.x, playerZ: P.z, playerHeading: P.heading, time: this.time,
    });
    this.saveTimer += dt;
    if (this.saveTimer > 10) { this.saveTimer = 0; this.save(); }
  }

  render() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer.resize(w, h);
    const P = this.player;
    let eye, target;
    if (this.state === 'menu' && !this.shotMode) {
      // Attract mode: slow orbit over the town.
      const a = this.time * 0.05;
      eye = [Math.cos(a) * 190, 70, Math.sin(a) * 190];
      target = [0, 8, 0];
    } else if (this.camera.fixed) {
      eye = this.camera.fixed.eye;
      target = this.camera.fixed.target;
    } else {
      // Chase camera: behind the player/car, smoothed.
      const moving = P.inCar ? Math.abs(P.inCar.speed) > 2 : P.moving;
      if (moving) {
        // Chase cam: settle behind the direction of travel. Camera yaw
        // equals the heading, so the eye sits south of a northbound player.
        const want = P.heading;
        let diff = want - this.camera.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.camera.yaw += diff * 0.03;
      }
      const yaw = this.camera.yaw + this.camera.yawOffset;
      const dist = P.inCar ? this.camera.dist : 9;
      const height = P.inCar ? 5.2 : 4.2;
      target = [P.x, 1.6, P.z];
      eye = [
        P.x + Math.sin(yaw) * dist,
        height + (P.inCar ? Math.abs(P.inCar.speed) * 0.04 : 0),
        P.z + Math.cos(yaw) * dist,
      ];
    }
    const proj = m4perspective((62 * Math.PI) / 180, w / h, 0.1, 2200);
    const view = m4lookAt(eye, target, [0, 1, 0]);
    const inStorm = this.storm.active && dist2d(P.x, P.z, this.storm.x, this.storm.z) < this.storm.r;
    const cars = [];
    for (const c of this.drivable) {
      cars.push({ x: c.x, y: c.y, z: c.z, heading: c.heading, pitch: c.pitch || 0, key: c.key, color: c.color });
    }
    for (const c of this.police.cruisers) {
      cars.push({ x: c.x, y: 0, z: c.z, heading: c.heading, pitch: 0, key: c.key, color: c.color });
    }
    const shadows = cars.map((c) => ({ x: c.x, z: c.z, w: 2.4, d: 4.8, rot: c.heading }));
    if (!P.inCar && this.state !== 'menu') shadows.push({ x: P.x, z: P.z, w: 1.2, d: 1.2, rot: 0 });
    this.renderer.setParticles(this.dust.particles);
    this.renderer.draw(
      { proj, view, eye, target },
      {
        cars,
        peds: this.peds.map((p) => ({ x: p.x, z: p.z, heading: p.heading, key: p.key, shirt: p.shirt })),
        player: P.inCar || this.state === 'menu' ? null : { x: P.x, z: P.z, heading: P.heading },
        shadows,
        stormInside: inStorm,
      },
    );
  }
}

// --- boot --------------------------------------------------------------------
try {
  const game = new DustGame();
  window.__DUSTLINE = {
    game,
    get state() { return game.state; },
    get started() { return game.started; },
    get wanted() { return game.police.wanted; },
    get mission() { return game.missions.index; },
    get fps() { return Math.round(game.fps); },
    get player() { return { x: game.player.x, z: game.player.z, inCar: !!game.player.inCar, health: game.player.health, cash: game.player.money }; },
    get errors() { return game.errors; },
    version: 'dustline-r4',
  };
  // Screenshot mode: skip the menu, stage the scene, start playing.
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot');
  if (shot) {
    game.audio.init();
    applyShot(game, parseInt(shot, 10));
  } else if (params.get('autoplay')) {
    game.startGame();
  }
} catch (e) {
  document.getElementById('menu-title').textContent = 'DUSTLINE — failed to start';
  document.getElementById('menu-sub').textContent = String(e && e.message ? e.message : e);
  window.__DUSTLINE_ERROR = String(e && e.message ? e.message : e);
}
