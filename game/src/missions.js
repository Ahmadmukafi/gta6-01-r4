// DUSTLINE — missions.js
// The story: Rook, a getaway driver in Dustline City, takes five jobs for
// the fixer "Marisol" — and the last one is the score that gets them out.
// Each mission is a chain of objectives: drive to a marker, do the thing,
// drive to the next marker. Rewards are cash; cash is the score.

import { dist2d } from './math3.js';

// Mission definitions. marker: {x, z, label} per objective.
export const MISSIONS = [
  {
    id: 'first-fare',
    title: 'JOB 1 — FIRST FARE',
    intro: 'Marisol: "Rook. Package at the Saguaro Motel. Diner wants it before the coffee goes cold. Don\'t scratch the paint."',
    objectives: [
      { type: 'goto', x: -180, z: 36, label: 'Pick up the package — Saguaro Motel', radius: 8 },
      { type: 'goto', x: -90, z: 66, label: 'Deliver the package — Dusty Spur Diner', radius: 8 },
    ],
    reward: 250,
    outro: 'Delivered. The diner cook slipped you an extra fifty. Word gets around.',
  },
  {
    id: 'dust-devil',
    title: 'JOB 2 — DUST DEVIL',
    intro: 'Marisol: "Sheriff\'s got your plate, Rook. Two stars. Lose them — and use the dust, that\'s what it\'s for. Press Q to kick a cloud in their faces."',
    objectives: [
      { type: 'heat', label: 'Lose the heat — break line of sight, hide in dust or the storm', heat: 2 },
    ],
    reward: 400,
    outro: 'Clean. The sheriff\'s boys are still coughing sand out of their radiators.',
    startHeat: 2,
  },
  {
    id: 'highway-run',
    title: 'JOB 3 — HIGHWAY RUN',
    intro: 'Marisol: "A buyer on the east side wants the papers before sundown. The ring road is the fast way — and the sheriff knows it too. 75 seconds."',
    objectives: [
      { type: 'goto', x: 0, z: -330, label: 'Hit the north checkpoint', radius: 12 },
      { type: 'goto', x: 330, z: 0, label: 'Reach the airfield gate', radius: 12 },
    ],
    reward: 600,
    outro: 'Seventy-five seconds of highway and you made it look easy.',
    timeLimit: 75,
  },
  {
    id: 'mirage-job',
    title: 'JOB 4 — THE MIRAGE JOB',
    intro: 'Marisol: "The Mirage valet parks a cream Cordova every Friday. Take it. The chop shop on the west side pays cash — but the valet will call it in. Expect company."',
    objectives: [
      { type: 'goto', x: 60, z: -16, label: 'Steal the cream Cordova — Mirage valet', radius: 7 },
      { type: 'steal', label: 'Get in the Cordova and run', radius: 5 },
      { type: 'goto', x: -240, z: -180, label: 'Deliver the Cordova — chop shop', radius: 9 },
    ],
    reward: 1200,
    outro: 'Twelve hundred, clean. The Cordova is already in pieces.',
    startHeat: 2,
  },
  {
    id: 'sandstorm-getaway',
    title: 'JOB 5 — SANDSTORM GETAWAY',
    intro: 'Marisol: "Last one, Rook. The score\'s at the Starlite. The storm\'s coming in from the west — ride inside it and the sheriff can\'t see you. Get to the airfield. Then we\'re gone."',
    objectives: [
      { type: 'goto', x: -180, z: -156, label: 'Grab the score — Starlite Drive-In', radius: 9 },
      { type: 'goto', x: 330, z: 0, label: 'Escape to Dustline Airfield', radius: 12 },
    ],
    reward: 2500,
    outro: 'You made it. The plane\'s waiting, the storm\'s behind you, and Dustline is in the rear-view. That\'s a wrap, Rook.',
    startHeat: 3,
    forceStorm: true,
  },
];

export function makeMissionState() {
  return {
    index: 0, // which mission is active
    objective: 0,
    timer: 0,
    done: false,
    allDone: false,
    message: '',
    messageTimer: 0,
  };
}

export function currentMission(state) {
  return MISSIONS[state.index] || null;
}
export function currentObjective(state) {
  const m = currentMission(state);
  return m ? m.objectives[state.objective] || null : null;
}

export function startMission(state, index, hooks) {
  const m = MISSIONS[index];
  if (!m) return;
  state.index = index;
  state.objective = 0;
  state.timer = 0;
  state.done = false;
  state.message = m.intro;
  state.messageTimer = 8;
  if (m.startHeat && hooks && hooks.setHeat) hooks.setHeat(m.startHeat);
  if (m.forceStorm && hooks && hooks.forceStorm) hooks.forceStorm();
  if (hooks && hooks.onStart) hooks.onStart(m);
}

// Advance the mission state. Returns 'objective' | 'mission' | 'alldone' | null.
// ctx: { playerX, playerZ, inCar, car, wanted, dt, hooks }
export function updateMissions(state, ctx) {
  const m = currentMission(state);
  if (!m || state.allDone) return null;
  const obj = currentObjective(state);
  if (!obj) return null;
  state.timer += ctx.dt;
  if (m.timeLimit && state.timer > m.timeLimit) {
    state.message = 'Too slow — the buyer walked. Marisol gives you one more shot.';
    state.messageTimer = 5;
    state.timer = 0;
    state.objective = 0;
    return 'failed';
  }
  if (obj.type === 'goto' || obj.type === 'steal') {
    const d = dist2d(ctx.playerX, ctx.playerZ, obj.x, obj.z);
    const needCar = obj.type === 'steal' ? ctx.inCar : true;
    if (d < obj.radius && needCar) {
      state.objective++;
      if (state.objective >= m.objectives.length) {
        return finishMission(state, ctx);
      }
      state.message = nextObjectiveText(m, state.objective);
      state.messageTimer = 5;
      return 'objective';
    }
  } else if (obj.type === 'heat') {
    if (ctx.wanted === 0) {
      state.objective++;
      if (state.objective >= m.objectives.length) return finishMission(state, ctx);
      return 'objective';
    }
  }
  return null;
}

function nextObjectiveText(m, i) {
  return m.objectives[i].label;
}

function finishMission(state, ctx) {
  const m = currentMission(state);
  state.done = true;
  state.message = m.outro + `  +$${m.reward}`;
  state.messageTimer = 7;
  if (ctx.hooks && ctx.hooks.onReward) ctx.hooks.onReward(m.reward);
  if (ctx.hooks && ctx.hooks.onComplete) ctx.hooks.onComplete(m);
  if (state.index + 1 >= MISSIONS.length) {
    state.allDone = true;
    return 'alldone';
  }
  // Next mission starts after a short breather.
  state.index++;
  state.objective = 0;
  state.timer = 0;
  state.done = false;
  const next = currentMission(state);
  state.message = next.intro;
  state.messageTimer = 8;
  if (next.startHeat && ctx.hooks && ctx.hooks.setHeat) ctx.hooks.setHeat(next.startHeat);
  if (next.forceStorm && ctx.hooks && ctx.hooks.forceStorm) ctx.hooks.forceStorm();
  return 'mission';
}

// The active marker for the HUD + minimap.
export function activeMarker(state) {
  const obj = currentObjective(state);
  if (!obj) return null;
  if (obj.type === 'heat') return null;
  return { x: obj.x, z: obj.z, label: obj.label };
}

export function missionProgressText(state) {
  const m = currentMission(state);
  if (!m) return 'All jobs done.';
  const obj = currentObjective(state);
  if (!obj) return m.title;
  if (obj.type === 'heat') return `${m.title} — ${obj.label}`;
  return `${m.title} — ${obj.label}`;
}
