// DUSTLINE — math3.js
// Small vector / matrix helpers for the raw-WebGL renderer. Written from scratch
// for this game: no library, no copied code. Column-major mat4, right-handed.

// ---- vec3 ---------------------------------------------------------------
export function v3(x = 0, y = 0, z = 0) { return [x, y, z]; }
export function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function v3cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function v3len(a) { return Math.hypot(a[0], a[1], a[2]); }
export function v3norm(a) {
  const l = v3len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export function v3lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
// Distance on the ground plane (ignores y).
export function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
// Wrap an angle to [-PI, PI].
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---- mat4 (column-major Float32Array(16)) ---------------------------------
export function m4identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
export function m4mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}
export function m4translate(x, y, z) {
  const m = m4identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}
export function m4scale(x, y, z) {
  const m = m4identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}
// Rotation about the Y axis (heading). Positive angle turns left (+x toward -z).
export function m4rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}
export function m4rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}
export function m4rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
export function m4perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}
// Look-at view matrix (eye, target, up). Returns view = inverse of camera transform.
export function m4lookAt(eye, target, up) {
  const z = v3norm(v3sub(eye, target));
  const x = v3norm(v3cross(up, z));
  const y = v3cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -v3dot(x, eye), -v3dot(y, eye), -v3dot(z, eye), 1,
  ]);
}
// Transform a point by a mat4.
export function m4point(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}
// Heading (radians) from a 2D direction vector.
export function headingOf(dx, dz) { return Math.atan2(-dx, -dz); }
