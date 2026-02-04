/**
 * HYPERBOLIC CORE v1.0 - Conservative Edition
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Minimal, rock-solid Poincaré disk visualization.
 * ~800 lines of essential functionality only.
 *
 * INCLUDES:
 * - Complex arithmetic with numerical guards
 * - Möbius transformations
 * - Geodesic rendering
 * - Pan, zoom, click interaction
 * - Basic node/edge rendering
 *
 * EXCLUDES (see hyperbolic-engine.js for full version):
 * - Geometric overlays (Voronoi, tilings, etc.)
 * - Multiple minimaps
 * - Infrastructure observables
 * - Advanced HUD features
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const EPSILON = 1e-10;
const DISK_BOUNDARY_EPS = 1e-5;
const MAX_ATANH_ARG = 0.99999;
const TARGET_FPS = 60;
const FRAME_TIME_MS = 1000 / TARGET_FPS;
const CANVAS_PADDING = 60;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;

// ════════════════════════════════════════════════════════════════════════════
// NUMERICAL GUARDS
// ════════════════════════════════════════════════════════════════════════════

const isValidNumber = x => typeof x === 'number' && isFinite(x) && !isNaN(x);
const isValidComplex = z => z && isValidNumber(z.re) && isValidNumber(z.im);
const clampNumber = (x, min, max) => Math.max(min, Math.min(max, x));

// ════════════════════════════════════════════════════════════════════════════
// COMPLEX ARITHMETIC
// ════════════════════════════════════════════════════════════════════════════

const ORIGIN = Object.freeze({ re: 0, im: 0 });

const C = (re, im = 0) => ({
  re: isValidNumber(re) ? re : 0,
  im: isValidNumber(im) ? im : 0
});

const cadd = (a, b) => {
  if (!a || !b) return ORIGIN;
  const re = a.re + b.re, im = a.im + b.im;
  return { re: isFinite(re) ? re : 0, im: isFinite(im) ? im : 0 };
};

const csub = (a, b) => {
  if (!a || !b) return ORIGIN;
  const re = a.re - b.re, im = a.im - b.im;
  return { re: isFinite(re) ? re : 0, im: isFinite(im) ? im : 0 };
};

const cmul = (a, b) => {
  if (!a || !b) return ORIGIN;
  const re = a.re * b.re - a.im * b.im;
  const im = a.re * b.im + a.im * b.re;
  return { re: isFinite(re) ? re : 0, im: isFinite(im) ? im : 0 };
};

const cscale = (a, k) => {
  if (!a || !isValidNumber(k)) return ORIGIN;
  const re = a.re * k, im = a.im * k;
  return { re: isFinite(re) ? re : 0, im: isFinite(im) ? im : 0 };
};

const cconj = a => a ? { re: a.re, im: -a.im } : ORIGIN;
const cabs2 = a => a ? (a.re * a.re + a.im * a.im) : 0;
const cabs = a => Math.sqrt(cabs2(a));
const carg = a => a ? Math.atan2(a.im, a.re) : 0;
const cpolar = (r, t) => isValidNumber(r) && isValidNumber(t) ? { re: r * Math.cos(t), im: r * Math.sin(t) } : ORIGIN;

const cdiv = (a, b) => {
  const d = cabs2(b);
  if (d < EPSILON * EPSILON) return ORIGIN;
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};

const clampDisk = (z, eps = DISK_BOUNDARY_EPS) => {
  if (!isValidComplex(z)) return C(0, 0);
  const r = cabs(z);
  if (r < EPSILON) return C(0, 0);
  return r >= 1 - eps ? cscale(z, (1 - eps) / r) : z;
};

// ════════════════════════════════════════════════════════════════════════════
// HYPERBOLIC GEOMETRY
// ════════════════════════════════════════════════════════════════════════════

function mobius(a, z) {
  if (!isValidComplex(a) || !isValidComplex(z)) return C(0, 0);
  if (cabs(a) < EPSILON) return z;
  const num = csub(z, a);
  const den = csub(C(1), cmul(cconj(a), z));
  return clampDisk(cdiv(num, den));
}

function mobiusInv(a, w) {
  if (!isValidComplex(a) || !isValidComplex(w)) return C(0, 0);
  if (cabs(a) < EPSILON) return w;
  const num = cadd(w, a);
  const den = cadd(C(1), cmul(cconj(a), w));
  return clampDisk(cdiv(num, den));
}

function hypDist(z, w) {
  if (!isValidComplex(z) || !isValidComplex(w)) return Infinity;
  const diff = csub(z, w);
  if (cabs(diff) < EPSILON) return 0;
  const num = cabs(diff);
  const den = cabs(csub(C(1), cmul(cconj(z), w)));
  if (den < EPSILON) return Infinity;
  const ratio = num / den;
  if (ratio >= 1) return Infinity;
  return 2 * Math.atanh(Math.min(ratio, MAX_ATANH_ARG));
}

function geodesicLerp(z1, z2, t) {
  if (!isValidComplex(z1)) return z2;
  if (!isValidComplex(z2)) return z1;
  if (t <= 0) return z1;
  if (t >= 1) return z2;
  t = clampNumber(t, 0, 1);
  const w = mobius(z1, z2);
  const r = cabs(w);
  if (r < EPSILON) return z1;
  const rClamped = Math.min(r, MAX_ATANH_ARG);
  const rInterp = Math.tanh(t * Math.atanh(rClamped));
  return clampDisk(mobiusInv(z1, cpolar(rInterp, carg(w))));
}

function geodesicArc(z1, z2) {
  if (!isValidComplex(z1) || !isValidComplex(z2)) return null;
  if (cabs(csub(z1, z2)) < EPSILON) return null;

  const cross = z1.re * z2.im - z1.im * z2.re;
  if (Math.abs(cross) < 1e-4) return { type: 'line', z1, z2 };

  // Circle center for geodesic perpendicular to boundary
  const r1 = cabs2(z1), r2 = cabs2(z2);
  const denom = 2 * cross;
  const cx = ((1 + r1) * z2.im - (1 + r2) * z1.im) / denom;
  const cy = ((1 + r2) * z1.re - (1 + r1) * z2.re) / denom;
  const center = C(cx, cy);
  const radius = cabs(csub(z1, center));

  return { type: 'arc', center, radius, z1, z2 };
}

// ════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════

const state = {
  camera: C(0, 0),
  targetCamera: C(0, 0),
  zoom: 1.0,
  targetZoom: 1.0,
  focus: 0,
  selected: new Set([0]),
  hovered: null,
  velocity: C(0, 0),
  friction: 0.88,
  dragging: false,
  dragStart: null,
  lastPointer: null,
  lastTime: 0,
  nodes: new Map(),
  edges: []
};

// ════════════════════════════════════════════════════════════════════════════
// DEMO DATA
// ════════════════════════════════════════════════════════════════════════════

function initDemoGraph() {
  // Create a simple tree structure
  const nodes = [
    { id: 0, name: 'Root', z: C(0, 0), depth: 0, parent: null },
  ];

  // Add children in a circle
  const childCount = 6;
  for (let i = 0; i < childCount; i++) {
    const angle = (i / childCount) * Math.PI * 2;
    const r = 0.5;
    nodes.push({
      id: i + 1,
      name: `Node ${i + 1}`,
      z: cpolar(r, angle),
      depth: 1,
      parent: 0
    });
  }

  // Add grandchildren
  let id = childCount + 1;
  for (let i = 1; i <= childCount; i++) {
    const parentZ = nodes[i].z;
    const baseAngle = carg(parentZ);
    for (let j = 0; j < 3; j++) {
      const angle = baseAngle + (j - 1) * 0.4;
      const childZ = mobiusInv(parentZ, cpolar(0.4, angle - baseAngle));
      nodes.push({
        id: id,
        name: `Node ${id}`,
        z: clampDisk(childZ),
        depth: 2,
        parent: i
      });
      id++;
    }
  }

  // Build node map and edges
  state.nodes.clear();
  state.edges = [];

  for (const node of nodes) {
    state.nodes.set(node.id, node);
    if (node.parent !== null) {
      state.edges.push([node.parent, node.id]);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CANVAS SETUP
// ════════════════════════════════════════════════════════════════════════════

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resize);

// ════════════════════════════════════════════════════════════════════════════
// COORDINATE TRANSFORMS
// ════════════════════════════════════════════════════════════════════════════

function getDiskParams(W, H) {
  const R = Math.min(W, H) / 2 - CANVAS_PADDING;
  return { cx: W / 2, cy: H / 2, R };
}

function toScreen(z, W, H) {
  const { cx, cy, R } = getDiskParams(W, H);
  return { x: cx + z.re * R * state.zoom, y: cy + z.im * R * state.zoom };
}

function fromScreen(x, y, W, H) {
  const { cx, cy, R } = getDiskParams(W, H);
  return C((x - cx) / (R * state.zoom), (y - cy) / (R * state.zoom));
}

function transformNode(node) {
  return clampDisk(mobius(state.camera, node.z));
}

// ════════════════════════════════════════════════════════════════════════════
// RENDERING
// ════════════════════════════════════════════════════════════════════════════

let lastRenderTime = 0;

function render() {
  try {
    // State validation
    if (!isValidComplex(state.camera)) state.camera = C(0, 0);
    if (!isValidComplex(state.targetCamera)) state.targetCamera = C(0, 0);
    if (!isFinite(state.zoom) || state.zoom <= 0) state.zoom = 1;
    if (!isFinite(state.targetZoom) || state.targetZoom <= 0) state.targetZoom = 1;

    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    if (W < 10 || H < 10) { requestAnimationFrame(render); return; }

    const now = performance.now();
    if (now - lastRenderTime < FRAME_TIME_MS) { requestAnimationFrame(render); return; }
    lastRenderTime = now;

    updatePhysics();
    ctx.clearRect(0, 0, W, H);

    drawBackground(W, H);
    drawEdges(W, H);
    drawNodes(W, H);
  } catch (e) {
    console.error('Render error:', e);
  }

  requestAnimationFrame(render);
}

function drawBackground(W, H) {
  const { cx, cy, R } = getDiskParams(W, H);

  // Dark background
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);

  // Disk boundary
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(100, 150, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawEdges(W, H) {
  const { R } = getDiskParams(W, H);

  for (const [aid, bid] of state.edges) {
    const a = state.nodes.get(aid);
    const b = state.nodes.get(bid);
    if (!a || !b) continue;

    const za = transformNode(a);
    const zb = transformNode(b);
    if (cabs(za) > 1.5 && cabs(zb) > 1.5) continue;

    const p1 = toScreen(za, W, H);
    const p2 = toScreen(zb, W, H);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    const arc = geodesicArc(za, zb);
    if (!arc) continue;

    ctx.beginPath();
    if (arc.type === 'line') {
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    } else {
      const pc = toScreen(arc.center, W, H);
      const sR = arc.radius * R * state.zoom;
      const t1 = Math.atan2(p1.y - pc.y, p1.x - pc.x);
      const t2 = Math.atan2(p2.y - pc.y, p2.x - pc.x);
      let dt = t2 - t1;
      while (dt > Math.PI) dt -= 2 * Math.PI;
      while (dt < -Math.PI) dt += 2 * Math.PI;
      ctx.arc(pc.x, pc.y, sR, t1, t2, dt < 0);
    }
    ctx.stroke();
  }
}

function drawNodes(W, H) {
  // Sort by distance (far to near)
  const sorted = [...state.nodes.values()]
    .map(n => ({ node: n, dist: cabs2(transformNode(n)) }))
    .sort((a, b) => b.dist - a.dist);

  for (const { node } of sorted) {
    const z = transformNode(node);
    const r2 = cabs2(z);
    if (r2 > 2) continue;

    const p = toScreen(z, W, H);
    const isFocus = node.id === state.focus;
    const isHovered = node.id === state.hovered;

    // Size based on depth and distance
    const baseSize = isFocus ? 14 : 7;
    const distScale = 1.3 - 0.8 * Math.min(1, Math.sqrt(r2));
    let size = baseSize * (1 - node.depth * 0.05) * distScale;
    if (isHovered) size *= 1.15;

    // Color based on depth
    const hue = 220 + node.depth * 30;
    const sat = isFocus ? 80 : 60;
    const lum = isFocus ? 65 : 50;
    const color = `hsl(${hue}, ${sat}%, ${lum}%)`;

    // Glow for focus
    if (isFocus) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size + 10, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.2)`;
      ctx.fill();
    }

    // Node body
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Label for focus or nearby nodes
    if (isFocus || r2 < 0.3) {
      ctx.font = '11px system-ui';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.textAlign = 'center';
      ctx.fillText(node.name, p.x, p.y + size + 14);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PHYSICS
// ════════════════════════════════════════════════════════════════════════════

function updatePhysics() {
  // Momentum
  if (!state.dragging && cabs(state.velocity) > 0.0001) {
    const step = cscale(state.velocity, 0.016);
    state.camera = clampDisk(mobiusInv(step, state.camera));
    state.velocity = cscale(state.velocity, state.friction);
  }

  // Smooth camera
  if (!state.dragging && cabs(csub(state.camera, state.targetCamera)) > 0.001) {
    state.camera = geodesicLerp(state.camera, state.targetCamera, 0.12);
  }

  // Smooth zoom
  if (Math.abs(state.zoom - state.targetZoom) > 0.001) {
    state.zoom += (state.targetZoom - state.zoom) * 0.15;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HIT TESTING
// ════════════════════════════════════════════════════════════════════════════

function hitTest(x, y) {
  const rect = canvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;

  let closest = null;
  let closestD2 = 400; // 20px threshold squared

  for (const node of state.nodes.values()) {
    const z = transformNode(node);
    if (cabs2(z) > 2) continue;

    const p = toScreen(z, W, H);
    const dx = p.x - x, dy = p.y - y;
    const d2 = dx * dx + dy * dy;

    if (d2 < closestD2) {
      closestD2 = d2;
      closest = node;
    }
  }

  return closest;
}

// ════════════════════════════════════════════════════════════════════════════
// INTERACTION
// ════════════════════════════════════════════════════════════════════════════

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  state.dragging = true;
  state.dragStart = { x: e.offsetX, y: e.offsetY };
  state.lastPointer = { x: e.offsetX, y: e.offsetY };
  state.lastTime = performance.now();
  state.velocity = C(0, 0);
});

canvas.addEventListener('pointermove', e => {
  const hit = hitTest(e.offsetX, e.offsetY);
  state.hovered = hit ? hit.id : null;
  canvas.style.cursor = hit ? 'pointer' : (state.dragging ? 'grabbing' : 'grab');

  if (!state.dragging) return;

  const rect = canvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  const dt = Math.max(1, performance.now() - state.lastTime) / 1000;

  const z0 = fromScreen(state.lastPointer.x, state.lastPointer.y, W, H);
  const z1 = fromScreen(e.offsetX, e.offsetY, W, H);
  const delta = csub(z0, z1);
  const scaleFactor = 0.75 / Math.max(0.3, state.zoom);
  const step = clampDisk(cscale(delta, scaleFactor));

  state.camera = clampDisk(mobiusInv(step, state.camera));
  state.targetCamera = state.camera;
  state.velocity = cscale(delta, scaleFactor / dt * 0.3);

  state.lastPointer = { x: e.offsetX, y: e.offsetY };
  state.lastTime = performance.now();
});

canvas.addEventListener('pointerup', () => {
  state.dragging = false;
});

canvas.addEventListener('click', e => {
  const hit = hitTest(e.offsetX, e.offsetY);
  if (hit) {
    state.focus = hit.id;
    state.selected.clear();
    state.selected.add(hit.id);
    // Move camera to focus on node
    state.targetCamera = hit.z;
  }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.002);
  state.targetZoom = clampNumber(state.targetZoom * factor, ZOOM_MIN, ZOOM_MAX);
}, { passive: false });

// ════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════

function init() {
  resize();
  initDemoGraph();
  render();
  console.log('Hyperbolic Core initialized with', state.nodes.size, 'nodes');
}

// Auto-init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for external use
window.HyperbolicCore = {
  state,
  C,
  mobius,
  mobiusInv,
  hypDist,
  geodesicLerp,
  clampDisk
};
