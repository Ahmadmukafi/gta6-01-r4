// DUSTLINE — shots.js
// Screenshot staging. When the page opens with ?shot=1..4 the game skips the
// menu and arranges a fixed, readable scene: the car, the dust, the police,
// the mission objective and the HUD all in one frame. Each preset is a
// different system of the game, so the four screenshots together show the
// whole open world. Used only for the maker's own screenshots.

import { makeCar } from './vehicles.js';

// Long-life dust motes placed by hand so the cloud is still there when the
// screenshot is taken, even on a slow machine.
function longDust(game, x, z, n, r) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r;
    game.dust.particles.push({
      x: x + Math.cos(a) * d, y: 0.6 + Math.random() * 5,
      z: z + Math.sin(a) * d,
      vx: 0, vy: 0.15, vz: 0,
      life: 60, maxLife: 60,
      size: 9 + Math.random() * 9, alpha: 0.5,
    });
  }
}

// game: the live game object from main.js.
// Sets camera.fixed = { eye, target } and arranges cars, heat and mission.
export function applyShot(game, n) {
  const P = game.player;
  const setHeat = (w) => {
    game.police.heat = [0, 12, 35, 55, 75, 92][w] || 0;
    game.police.wanted = w;
    game.police.cruisers.length = 0;
  };
  const putCar = (x, z, heading, speed, colorKey, color) => {
    const car = makeCar(x, z, heading, colorKey, color);
    car.speed = speed;
    game.traffic.push(car);
    game.drivable.push(car); // render() draws this.drivable, not this.traffic
    return car;
  };
  const putPolice = (x, z, heading, speed) => {
    const car = makeCar(x, z, heading, 'police', [0.12, 0.14, 0.2]);
    car.speed = speed;
    car.ai = { police: true };
    game.police.cruisers.push(car);
    return car;
  };

  if (n === 1) {
    // COVER — the dust kick on Mirage Boulevard, police on your tail.
    // Camera sits low behind the car, looking north up the boulevard: the
    // rust car, the dust cloud boiling off its tail, two cruisers behind.
    game.missions.index = 3;
    game.missions.objective = 2;
    game.missions.message = '';
    game.missions.messageTimer = 0;
    setHeat(2);
    const car = putCar(0, -40, 0, 14, 'rust', [0.62, 0.25, 0.15]);
    P.inCar = car;
    P.x = car.x; P.z = car.z;
    car.dustCharges = 3;
    game.spawnDustCloud(car.x, car.z + 7, 16);
    longDust(game, car.x, car.z + 7, 46, 10);
    longDust(game, car.x - 2, car.z + 12, 24, 7);
    putPolice(8, -14, 0, 18);
    putPolice(-9, -2, 0.1, 16);
    putCar(-3.2, -90, Math.PI, 9, 'teal', [0.15, 0.5, 0.5]);
    putCar(3.2, 30, 0, 8, 'cream', [0.85, 0.78, 0.6]);
    game.camera.fixed = { eye: [6, 4.5, -6], target: [0, 2, -42] };
    game.camera.dist = 11;
  } else if (n === 2) {
    // ON FOOT — Rook at the Gas-O-Line with the storm wall behind town.
    game.missions.index = 0;
    game.missions.objective = 0;
    game.missions.message = 'Marisol: "Package at the Saguaro Motel. Don\'t scratch the paint."';
    game.missions.messageTimer = 30;
    setHeat(1);
    P.inCar = null;
    P.x = 168; P.z = 150;
    P.heading = Math.PI * 0.75;
    game.storm.active = true;
    game.storm.strength = 1;
    game.storm.x = 140;
    game.storm.z = 280;
    game.storm.r = 150;
    longDust(game, 140, 230, 40, 60);
    putPolice(138, 172, -2.4, 8);
    putCar(183.2, 90, Math.PI / 2, 9, 'yellow', [0.85, 0.65, 0.15]);
    putCar(176.8, 240, -Math.PI / 2, 8, 'blue', [0.2, 0.3, 0.6]);
    game.camera.fixed = { eye: [158, 3.5, 138], target: [170, 2, 152] };
    game.camera.dist = 9;
  } else if (n === 3) {
    // HIGHWAY CHASE — full speed on the ring road, storm ahead.
    game.missions.index = 2;
    game.missions.objective = 1;
    game.missions.message = '';
    game.missions.messageTimer = 0;
    setHeat(3);
    const car = putCar(321, 120, 0, 34, 'rust', [0.62, 0.25, 0.15]);
    P.inCar = car;
    P.x = car.x; P.z = car.z;
    putPolice(312, 152, 0, 36);
    putPolice(330, 158, 0, 35);
    putPolice(321, 168, 0, 33);
    game.storm.active = true;
    game.storm.strength = 0.9;
    game.storm.x = 330;
    game.storm.z = -60;
    game.storm.r = 130;
    longDust(game, 330, -20, 50, 70);
    game.camera.fixed = { eye: [308, 4.5, 152], target: [321, 2, 108] };
    game.camera.dist = 12;
  } else if (n === 4) {
    // THE ESCAPE — the airstrip at sunset, the last job's final marker.
    // Camera above the east end of the runway, looking west down the strip
    // at the cream car coming in.
    game.missions.index = 4;
    game.missions.objective = 1;
    game.missions.message = '';
    game.missions.messageTimer = 0;
    setHeat(0);
    const car = putCar(296, 4, Math.PI / 2, 8, 'cream', [0.85, 0.78, 0.6]);
    P.inCar = car;
    P.x = car.x; P.z = car.z;
    putCar(310, -14, -Math.PI / 2, 0, 'teal', [0.15, 0.5, 0.5]);
    game.burstDust(312, -18, 18, 5);
    longDust(game, 312, -18, 16, 6);
    game.camera.fixed = { eye: [318, 3.2, 4], target: [296, 2, 4] };
    game.camera.dist = 14;
  }
  game.started = true;
  game.state = 'playing';
  game.hud.hideMenu();
}
