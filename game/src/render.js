// DUSTLINE — render.js
// A small raw-WebGL1 renderer written from scratch for this game: one
// lambert shader for all opaque geometry, a gradient sky dome, a soft-sprite
// particle system for dust, and flat alpha quads for blob shadows.
// Golden-hour sun from the west, warm haze fog.

import { m4identity, m4mul, m4translate, m4scale, m4rotY, m4rotX, m4rotZ, m4perspective, m4lookAt } from './math3.js';
import { makeGroundTexture, makeFacadeAtlas, makeBillboardTexture, makeDustSprite, makeWhiteTexture } from './textures.js';

const OPAQUE_VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUv;
attribute vec3 aColor;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vColor;
varying float vDepth;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 view = uView * world;
  vDepth = -view.z;
  vNormal = normalize(mat3(uModel) * aNormal);
  vUv = aUv;
  vColor = aColor;
  gl_Position = uProj * view;
}`;
const OPAQUE_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vColor;
varying float vDepth;
void main() {
  vec4 tex = texture2D(uTex, vUv);
  float diff = max(dot(normalize(vNormal), normalize(uSunDir)), 0.0);
  vec3 lit = tex.rgb * vColor * (uAmbient + uSunColor * diff);
  float f = clamp((vDepth - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  gl_FragColor = vec4(mix(lit, uFogColor, f), 1.0);
}`;

const SKY_VERT = `
attribute vec3 aPos;
uniform mat4 uProj;
uniform mat4 uView;
varying vec3 vDir;
void main() {
  vDir = aPos;
  vec4 p = uProj * uView * vec4(aPos, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = `
precision mediump float;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.05, 1.0);
  vec3 horizon = vec3(0.98, 0.62, 0.34);
  vec3 zenith = vec3(0.35, 0.48, 0.68);
  vec3 col = mix(horizon, zenith, pow(h, 0.6));
  float sun = max(dot(d, normalize(uSunDir)), 0.0);
  col += vec3(1.0, 0.75, 0.4) * pow(sun, 220.0) * 1.6;
  col += vec3(1.0, 0.6, 0.25) * pow(sun, 8.0) * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`;

const PARTICLE_VERT = `
attribute vec3 aPos;
attribute float aSize;
attribute float aAlpha;
uniform mat4 uProj;
uniform mat4 uView;
varying float vAlpha;
void main() {
  vec4 view = uView * vec4(aPos, 1.0);
  gl_PointSize = aSize * 300.0 / max(-view.z, 1.0);
  vAlpha = aAlpha;
  gl_Position = uProj * view;
}`;
const PARTICLE_FRAG = `
precision mediump float;
uniform sampler2D uTex;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(t.rgb, t.a * vAlpha);
}`;

const QUAD_VERT = `
attribute vec2 aPos;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCenter;
uniform vec2 uSize;
uniform float uRot;
varying vec2 vUv;
void main() {
  float c = cos(uRot), s = sin(uRot);
  vec2 p = vec2(aPos.x * c - aPos.y * s, aPos.x * s + aPos.y * c) * uSize;
  vec3 world = uCenter + vec3(p.x, 0.0, p.y);
  vUv = aPos * 0.5 + 0.5;
  gl_Position = uProj * uView * vec4(world, 1.0);
}`;
const QUAD_FRAG = `
precision mediump float;
uniform vec4 uColor;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float a = uColor.a * smoothstep(0.5, 0.28, length(d));
  gl_FragColor = vec4(uColor.rgb, a);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  return p;
}
function makeTexture(gl, canvas, repeat = false) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

// ---- mesh building --------------------------------------------------------
// A mesh is a flat array of vertices: pos(3) normal(3) uv(2) color(3).
export class MeshBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = [];
  }
  get count() { return this.idx.length; }
  // Append a box centred at (cx,cy,cz) with size (w,h,d).
  // uvRect: [u0,v0,u1,v1] mapped on the side faces; top/bottom use u0,v0.
  box(cx, cy, cz, w, h, d, color, uvRect = [0, 0, 1, 1], vRepeat = 1) {
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const y0 = cy - h / 2, y1 = cy + h / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    const [u0, v0, u1, v1] = uvRect;
    const vTop = v0 + (v1 - v0) * vRepeat;
    const faces = [
      // +x
      { n: [1, 0, 0], v: [[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]], uv: [[u0, v0], [u0, vTop], [u1, vTop], [u1, v0]] },
      // -x
      { n: [-1, 0, 0], v: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], uv: [[u0, v0], [u0, vTop], [u1, vTop], [u1, v0]] },
      // +z
      { n: [0, 0, 1], v: [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]], uv: [[u0, v0], [u0, vTop], [u1, vTop], [u1, v0]] },
      // -z
      { n: [0, 0, -1], v: [[x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0]], uv: [[u0, v0], [u0, vTop], [u1, vTop], [u1, v0]] },
      // +y (roof)
      { n: [0, 1, 0], v: [[x0, y1, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1]], uv: [[u0, v0], [u0, v0 + 0.05], [u1, v0 + 0.05], [u1, v0]] },
      // -y
      { n: [0, -1, 0], v: [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], uv: [[u0, v0], [u0, v0], [u1, v0], [u1, v0]] },
    ];
    for (const f of faces) {
      const base = this.pos.length / 3;
      for (let i = 0; i < 4; i++) {
        this.pos.push(...f.v[i]);
        this.nor.push(...f.n);
        this.uv.push(...f.uv[i]);
        this.col.push(...color);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  // A flat ground quad on the XZ plane at height y.
  quadXZ(cx, cz, w, d, y, color, uvRect = [0, 0, 1, 1]) {
    const [u0, v0, u1, v1] = uvRect;
    const base = this.pos.length / 3;
    const vs = [
      [cx - w / 2, y, cz - d / 2, u0, v0],
      [cx - w / 2, y, cz + d / 2, u0, v1],
      [cx + w / 2, y, cz + d / 2, u1, v1],
      [cx + w / 2, y, cz - d / 2, u1, v0],
    ];
    for (const [x, yy, z, u, v] of vs) {
      this.pos.push(x, yy, z);
      this.nor.push(0, 1, 0);
      this.uv.push(u, v);
      this.col.push(...color);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // A vertical quad facing +z (used for billboards and signs).
  quadXY(cx, cy, cz, w, h, color, uvRect = [0, 0, 1, 1], rotY = 0) {
    const [u0, v0, u1, v1] = uvRect;
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const base = this.pos.length / 3;
    const corners = [[-w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2]];
    const uvs = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
    for (let i = 0; i < 4; i++) {
      const [lx, ly] = corners[i];
      const x = cx + lx * c;
      const z = cz - lx * s;
      this.pos.push(x, cy + ly, z);
      this.nor.push(s, 0, c);
      this.uv.push(...uvs[i]);
      this.col.push(...color);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // A low cone (dune) with n segments.
  cone(cx, cz, r, h, color, segs = 8) {
    const base = this.pos.length / 3;
    const apex = this.pos.length / 3;
    this.pos.push(cx, h, cz);
    this.nor.push(0, 1, 0);
    this.uv.push(0.5, 0.5);
    this.col.push(...color);
    const ringStart = this.pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      this.pos.push(x, 0, z);
      this.nor.push(Math.cos(a) * 0.7, 0.7, Math.sin(a) * 0.7);
      this.uv.push(i / segs, 0);
      this.col.push(...color);
    }
    for (let i = 0; i < segs; i++) {
      this.idx.push(apex, ringStart + i + 1, ringStart + i);
    }
    void base;
  }
  build(gl) {
    const v = new Float32Array(this.pos.length + this.nor.length + this.uv.length + this.col.length);
    // Interleave: pos(3) nor(3) uv(2) col(3) = 11 floats per vertex.
    const n = this.pos.length / 3;
    const out = new Float32Array(n * 11);
    for (let i = 0; i < n; i++) {
      const o = i * 11;
      out[o] = this.pos[i * 3]; out[o + 1] = this.pos[i * 3 + 1]; out[o + 2] = this.pos[i * 3 + 2];
      out[o + 3] = this.nor[i * 3]; out[o + 4] = this.nor[i * 3 + 1]; out[o + 5] = this.nor[i * 3 + 2];
      out[o + 6] = this.uv[i * 2]; out[o + 7] = this.uv[i * 2 + 1];
      out[o + 8] = this.col[i * 3]; out[o + 9] = this.col[i * 3 + 1]; out[o + 10] = this.col[i * 3 + 2];
    }
    void v;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(this.idx), gl.STATIC_DRAW);
    return { vbo, ibo, count: this.idx.length };
  }
}

function bindMesh(gl, prog, mesh) {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
  const stride = 11 * 4;
  const aPos = gl.getAttribLocation(prog, 'aPos');
  const aNor = gl.getAttribLocation(prog, 'aNormal');
  const aUv = gl.getAttribLocation(prog, 'aUv');
  const aCol = gl.getAttribLocation(prog, 'aColor');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(aNor);
  gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, stride, 24);
  gl.enableVertexAttribArray(aCol);
  gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, stride, 32);
}

// ---- the renderer ---------------------------------------------------------
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('WebGL not available');
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.opaque = program(gl, OPAQUE_VERT, OPAQUE_FRAG);
    this.sky = program(gl, SKY_VERT, SKY_FRAG);
    this.particles = program(gl, PARTICLE_VERT, PARTICLE_FRAG);
    this.quad = program(gl, QUAD_VERT, QUAD_FRAG);
    // Sky dome: a big cube is enough for the gradient shader.
    const skyBuilder = new MeshBuilder();
    skyBuilder.box(0, 0, 0, 2, 2, 2, [1, 1, 1]);
    this.skyMesh = skyBuilder.build(gl);
    // Unit quad for blob shadows.
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    this.quadVbo = qb;
    this.whiteTex = null;
    this.groundTex = null;
    this.facadeTex = null;
    this.dustTex = null;
    this.billboardTex = [];
    this.meshes = {};
    this.carMeshes = new Map();
    this.pedMeshes = new Map();
    // Sun: low in the west, golden hour.
    this.sunDir = [0.55, 0.42, 0.25];
    const l = Math.hypot(...this.sunDir);
    this.sunDir = this.sunDir.map((v) => v / l);
    this.sunColor = [1.0, 0.72, 0.42];
    this.ambient = [0.42, 0.36, 0.3];
    this.fogColor = [0.87, 0.62, 0.4];
    this.fogNear = 130;
    this.fogFar = 720;
    this.particleCapacity = 700;
    this.particlesData = { pos: new Float32Array(this.particleCapacity * 3), size: new Float32Array(this.particleCapacity), alpha: new Float32Array(this.particleCapacity), count: 0 };
    this.pbufPos = gl.createBuffer();
    this.pbufSize = gl.createBuffer();
    this.pbufAlpha = gl.createBuffer();
  }

  initTextures(layout) {
    const gl = this.gl;
    this.groundTex = makeTexture(gl, makeGroundTexture(layout), false);
    this.facadeTex = makeTexture(gl, makeFacadeAtlas(), true);
    this.dustTex = makeTexture(gl, makeDustSprite(), false);
    this.whiteTex = makeTexture(gl, makeWhiteTexture(), false);
    for (const p of layout.props) {
      if (p.kind === 'billboard') {
        this.billboardTex.push(makeTexture(gl, makeBillboardTexture(p.lines, p.bg, p.fg, p.accent), false));
      }
    }
  }

  buildStatic(layout) {
    const gl = this.gl;
    // Ground: textured playfield + plain desert apron to the horizon.
    const gb = new MeshBuilder();
    gb.quadXZ(0, 0, 760, 760, 0, [1, 1, 1]);
    this.meshes.ground = gb.build(gl);
    const db = new MeshBuilder();
    db.quadXZ(0, 0, 2400, 2400, -0.1, [0.79, 0.56, 0.31]);
    this.meshes.desert = db.build(gl);
    // Buildings merged into one mesh, facade atlas, v repeated by height.
    const bb = new MeshBuilder();
    for (const b of layout.buildings) {
      const u0 = b.facade * 0.25, u1 = u0 + 0.25;
      const vRep = Math.max(1, Math.round(b.h / 12));
      bb.box(b.x, b.h / 2, b.z, b.w, b.h, b.d, b.color, [u0, 0, u1, 1], vRep);
    }
    this.meshes.buildings = bb.build(gl);
    // Props merged: cacti, palms, dunes, lamps, water tower, billboards.
    const pb = new MeshBuilder();
    let bi = 0;
    for (const p of layout.props) {
      if (p.kind === 'cactus') {
        const g = [0.24, 0.45, 0.2];
        pb.box(p.x, 1.6 * p.s, p.z, 0.7 * p.s, 3.2 * p.s, 0.7 * p.s, g);
        pb.box(p.x - 0.7 * p.s, 1.3 * p.s, p.z, 0.5 * p.s, 1.1 * p.s, 0.5 * p.s, g);
        pb.box(p.x + 0.7 * p.s, 1.5 * p.s, p.z, 0.5 * p.s, 1.3 * p.s, 0.5 * p.s, g);
      } else if (p.kind === 'dune') {
        pb.cone(p.x, p.z, p.s, 3.5, [0.83, 0.62, 0.36], 8);
      } else if (p.kind === 'palm') {
        pb.box(p.x, 3.5, p.z, 0.5, 7, 0.5, [0.45, 0.32, 0.2]);
        pb.box(p.x, 7.2, p.z, 4.5, 0.4, 1.2, [0.2, 0.5, 0.2]);
        pb.box(p.x, 7.2, p.z, 1.2, 0.4, 4.5, [0.2, 0.5, 0.2]);
      } else if (p.kind === 'lamp') {
        pb.box(p.x, 3, p.z, 0.25, 6, 0.25, [0.25, 0.25, 0.28]);
        pb.box(p.x, 6, p.z, 0.25, 0.4, 1.6, [0.25, 0.25, 0.28]);
        pb.box(p.x, 5.8, p.z + 0.7, 0.5, 0.3, 0.5, [1, 0.85, 0.5]);
      } else if (p.kind === 'watertower') {
        pb.box(p.x, 10, p.z, 2, 20, 2, [0.55, 0.55, 0.52]);
        pb.box(p.x, 10, p.z, 2, 20, 2, [0.55, 0.55, 0.52]);
        pb.box(p.x, 22, p.z, 12, 8, 12, [0.6, 0.6, 0.58]);
        pb.cone(p.x, p.z, 8.5, 28, [0.65, 0.3, 0.25], 8);
      } else if (p.kind === 'billboard') {
        // Post + face; texture applied separately (own draw with its texture).
        pb.box(p.x, 4, p.z, 0.8, 8, 0.8, [0.3, 0.3, 0.33]);
      }
    }
    this.meshes.props = pb.build(gl);
    // Billboard faces: one small mesh each (own texture).
    this.meshes.billboards = [];
    for (const p of layout.props) {
      if (p.kind !== 'billboard') continue;
      const b2 = new MeshBuilder();
      b2.quadXY(p.x, 11, p.z, 22, 11, [1, 1, 1], [0, 0, 1, 1], p.rot);
      this.meshes.billboards.push({ mesh: b2.build(gl), tex: this.billboardTex[bi++] });
    }
    // Player figure: body, head, cowboy hat.
    const pl = new MeshBuilder();
    pl.box(0, 0.85, 0, 0.55, 1.1, 0.35, [0.72, 0.6, 0.45]); // torso (duster coat)
    pl.box(0, 1.65, 0, 0.4, 0.4, 0.4, [0.85, 0.65, 0.5]); // head
    pl.box(0, 1.88, 0, 0.85, 0.07, 0.85, [0.35, 0.25, 0.15]); // hat brim
    pl.box(0, 1.98, 0, 0.45, 0.18, 0.45, [0.35, 0.25, 0.15]); // hat top
    pl.box(-0.32, 0.85, 0, 0.18, 0.9, 0.18, [0.72, 0.6, 0.45]); // arms
    pl.box(0.32, 0.85, 0, 0.18, 0.9, 0.18, [0.72, 0.6, 0.45]);
    pl.box(-0.15, 0.25, 0, 0.22, 0.5, 0.22, [0.25, 0.22, 0.3]); // legs
    pl.box(0.15, 0.25, 0, 0.22, 0.5, 0.22, [0.25, 0.22, 0.3]);
    this.meshes.player = pl.build(gl);
  }

  // A car mesh for a given body colour; cached per colour key.
  carMesh(key, bodyColor) {
    if (this.carMeshes.has(key)) return this.carMeshes.get(key);
    const b = new MeshBuilder();
    const body = bodyColor;
    const dark = [0.12, 0.12, 0.14];
    const glass = [0.15, 0.25, 0.32];
    const chrome = [0.75, 0.75, 0.78];
    b.box(0, 0.55, 0, 2.0, 0.65, 4.4, body);            // body
    b.box(0, 1.15, -0.3, 1.7, 0.55, 2.2, glass);        // cabin
    b.box(0, 1.0, -0.35, 1.75, 0.18, 2.3, body);        // roof edge
    b.box(0, 0.35, 2.25, 1.9, 0.35, 0.15, chrome);      // front bumper
    b.box(0, 0.35, -2.25, 1.9, 0.35, 0.15, chrome);     // rear bumper
    b.box(-0.7, 0.62, 2.22, 0.35, 0.2, 0.06, [1, 0.9, 0.6]); // headlights
    b.box(0.7, 0.62, 2.22, 0.35, 0.2, 0.06, [1, 0.9, 0.6]);
    b.box(-0.7, 0.62, -2.22, 0.35, 0.18, 0.06, [0.9, 0.1, 0.1]); // tail lights
    b.box(0.7, 0.62, -2.22, 0.35, 0.18, 0.06, [0.9, 0.1, 0.1]);
    for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
      b.box(wx, 0.38, wz, 0.3, 0.76, 0.85, dark);        // wheels
    }
    const mesh = b.build(this.gl);
    this.carMeshes.set(key, mesh);
    return mesh;
  }

  pedMesh(key, shirt) {
    if (this.pedMeshes.has(key)) return this.pedMeshes.get(key);
    const b = new MeshBuilder();
    b.box(0, 0.85, 0, 0.5, 1.0, 0.32, shirt);
    b.box(0, 1.6, 0, 0.36, 0.36, 0.36, [0.85, 0.65, 0.5]);
    b.box(-0.3, 0.85, 0, 0.16, 0.85, 0.16, shirt);
    b.box(0.3, 0.85, 0, 0.16, 0.85, 0.16, shirt);
    b.box(-0.14, 0.25, 0, 0.2, 0.5, 0.2, [0.2, 0.2, 0.28]);
    b.box(0.14, 0.25, 0, 0.2, 0.5, 0.2, [0.2, 0.2, 0.28]);
    const mesh = b.build(this.gl);
    this.pedMeshes.set(key, mesh);
    return mesh;
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  // particles: array of {x,y,z,size,alpha}
  setParticles(list) {
    const d = this.particlesData;
    d.count = Math.min(list.length, this.particleCapacity);
    for (let i = 0; i < d.count; i++) {
      d.pos[i * 3] = list[i].x;
      d.pos[i * 3 + 1] = list[i].y;
      d.pos[i * 3 + 2] = list[i].z;
      d.size[i] = list[i].size;
      d.alpha[i] = list[i].alpha;
    }
  }

  // Draw one frame.
  // view = { proj, view, eye } ; scene = { cars, peds, player, shadows, stormFog }
  draw(view, scene) {
    const gl = this.gl;
    const { proj, view: viewMat, eye } = view;
    gl.clearColor(this.fogColor[0], this.fogColor[1], this.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // --- sky dome (no depth write, drawn first) ---
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.sky);
    const skyView = m4lookAt([0, 0, 0], [viewMat[2], viewMat[6], viewMat[10]], [0, 1, 0]);
    // Simpler: sky follows camera rotation only — rebuild from eye direction.
    void skyView;
    const camDir = [eye[0] - view.target[0], eye[1] - view.target[1], eye[2] - view.target[2]];
    void camDir;
    const rotOnly = new Float32Array([
      viewMat[0], viewMat[1], viewMat[2], 0,
      viewMat[4], viewMat[5], viewMat[6], 0,
      viewMat[8], viewMat[9], viewMat[10], 0,
      0, 0, 0, 1,
    ]);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.sky, 'uProj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.sky, 'uView'), false, rotOnly);
    gl.uniform3fv(gl.getUniformLocation(this.sky, 'uSunDir'), this.sunDir);
    bindMesh(gl, this.sky, this.skyMesh);
    gl.drawElements(gl.TRIANGLES, this.skyMesh.count, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);

    // --- opaque pass ---
    gl.useProgram(this.opaque);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.opaque, 'uProj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.opaque, 'uView'), false, viewMat);
    gl.uniform3fv(gl.getUniformLocation(this.opaque, 'uSunDir'), this.sunDir);
    gl.uniform3fv(gl.getUniformLocation(this.opaque, 'uSunColor'), this.sunColor);
    gl.uniform3fv(gl.getUniformLocation(this.opaque, 'uAmbient'), this.ambient);
    gl.uniform3fv(gl.getUniformLocation(this.opaque, 'uFogColor'), this.fogColor);
    const fogNear = scene.stormInside ? 18 : this.fogNear;
    const fogFar = scene.stormInside ? 95 : this.fogFar;
    gl.uniform2f(gl.getUniformLocation(this.opaque, 'uFogRange'), fogNear, fogFar);
    const uModel = gl.getUniformLocation(this.opaque, 'uModel');
    const identity = m4identity();
    const drawMesh = (mesh, tex, model = identity) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniformMatrix4fv(uModel, false, model);
      bindMesh(gl, this.opaque, mesh);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    };
    drawMesh(this.meshes.desert, this.whiteTex);
    drawMesh(this.meshes.ground, this.groundTex);
    drawMesh(this.meshes.buildings, this.facadeTex);
    drawMesh(this.meshes.props, this.whiteTex);
    for (const bb of this.meshes.billboards) drawMesh(bb.mesh, bb.tex);
    // Cars.
    for (const car of scene.cars) {
      const model = m4mul(
        m4translate(car.x, car.y, car.z),
        m4mul(m4rotY(car.heading), m4rotX(car.pitch || 0)),
      );
      drawMesh(this.carMesh(car.key, car.color), this.whiteTex, model);
    }
    // Pedestrians.
    for (const p of scene.peds) {
      const model = m4mul(m4translate(p.x, 0, p.z), m4rotY(p.heading));
      drawMesh(this.pedMesh(p.key, p.shirt), this.whiteTex, model);
    }
    // Player on foot.
    if (scene.player) {
      const pl = scene.player;
      const model = m4mul(m4translate(pl.x, 0, pl.z), m4rotY(pl.heading));
      drawMesh(this.meshes.player, this.whiteTex, model);
    }

    // --- blob shadows (alpha quads) ---
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(this.quad);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.quad, 'uProj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.quad, 'uView'), false, viewMat);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    const qa = gl.getAttribLocation(this.quad, 'aPos');
    gl.enableVertexAttribArray(qa);
    gl.vertexAttribPointer(qa, 2, gl.FLOAT, false, 0, 0);
    const uCenter = gl.getUniformLocation(this.quad, 'uCenter');
    const uSize = gl.getUniformLocation(this.quad, 'uSize');
    const uRot = gl.getUniformLocation(this.quad, 'uRot');
    const uColor = gl.getUniformLocation(this.quad, 'uColor');
    for (const s of scene.shadows) {
      gl.uniform3f(uCenter, s.x, 0.06, s.z);
      gl.uniform2f(uSize, s.w, s.d);
      gl.uniform1f(uRot, s.rot || 0);
      gl.uniform4f(uColor, 0.08, 0.05, 0.03, 0.42);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }
    gl.depthMask(true);

    // --- dust particles ---
    const d = this.particlesData;
    if (d.count > 0) {
      gl.useProgram(this.particles);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.particles, 'uProj'), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.particles, 'uView'), false, viewMat);
      gl.bindTexture(gl.TEXTURE_2D, this.dustTex);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pbufPos);
      gl.bufferData(gl.ARRAY_BUFFER, d.pos.subarray(0, d.count * 3), gl.DYNAMIC_DRAW);
      let a = gl.getAttribLocation(this.particles, 'aPos');
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pbufSize);
      gl.bufferData(gl.ARRAY_BUFFER, d.size.subarray(0, d.count), gl.DYNAMIC_DRAW);
      a = gl.getAttribLocation(this.particles, 'aSize');
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pbufAlpha);
      gl.bufferData(gl.ARRAY_BUFFER, d.alpha.subarray(0, d.count), gl.DYNAMIC_DRAW);
      a = gl.getAttribLocation(this.particles, 'aAlpha');
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, d.count);
    }
    gl.disable(gl.BLEND);
  }
}

export { m4perspective, m4lookAt };
