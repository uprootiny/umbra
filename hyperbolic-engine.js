/**
 * HYPERBOLIC ENGINE v3.0
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Advanced Poincaré disk visualization engine with:
 *
 * GEOMETRY:
 * - True hyperbolic geodesics (circular arcs ⊥ boundary)
 * - Möbius transformations for isometric navigation
 * - Hyperbolic distance calculations
 * - Geodesic interpolation for smooth transitions
 * - Horocycles and equidistant curves
 * - Ideal points at infinity
 *
 * PHYSICS:
 * - Momentum-based panning with friction
 * - Smooth eased transitions
 * - Velocity clamping
 *
 * RENDERING:
 * - Depth-aware node sizing
 * - Semantic zoom (detail on demand)
 * - Edge bundling hints
 * - Glow and highlight effects
 * - Antialiased geodesics
 */

'use strict';

console.log('[HyperbolicEngine] Loading...');

// ════════════════════════════════════════════════════════════════════════════
// NUMERICAL CONSTANTS & GUARDS
// ════════════════════════════════════════════════════════════════════════════

const EPSILON = 1e-10;          // Near-zero threshold
const DISK_BOUNDARY_EPS = 1e-5; // Distance from disk boundary
const MAX_ATANH_ARG = 0.99999;  // Max argument for atanh (numerical stability)
const MAX_ITERATIONS = 1000;    // Prevent infinite loops

// ════════════════════════════════════════════════════════════════════════════
// UI & RENDERING CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const TARGET_FPS = 60;                    // Frame rate cap
const FRAME_TIME_MS = 1000 / TARGET_FPS;  // ~16.67ms per frame
const CANVAS_PADDING = 60;                // Padding around Poincaré disk
const UNDO_HISTORY_LIMIT = 100;           // Max undo steps

// Zoom limits and steps
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 1.3;                    // Multiplier for zoom in/out

// Camera animation
const CAMERA_LERP_FACTOR = 0.12;          // Smooth camera interpolation
const CAMERA_SNAP_THRESHOLD = 0.001;      // When to snap to target

// Node sizing
const NODE_DEPTH_SCALE_FACTOR = 0.03;     // Size reduction per depth level
const NODE_FOCUS_SIZE = 16;               // Focused node base size
const NODE_CHILD_SIZE = 10;               // Child of focus base size
const NODE_SELECTED_SIZE = 9;             // Selected node base size
const NODE_DEFAULT_SIZE = 7;              // Default node base size
const NODE_HOVER_SCALE = 1.15;            // Scale factor when hovered

// Semantic zoom
const SEMANTIC_ZOOM_MANY_CHILDREN = 5;    // Threshold for "many children"
const SEMANTIC_ZOOM_MIN = 0.6;            // Min zoom for many children
const SEMANTIC_ZOOM_LEAF_MAX = 2.0;       // Max zoom for leaf nodes

// Safe number check
const isValidNumber = x => typeof x === 'number' && isFinite(x) && !isNaN(x);
const isValidComplex = z => z && isValidNumber(z.re) && isValidNumber(z.im);

// Clamp to safe range
const clampNumber = (x, min, max) => Math.max(min, Math.min(max, x));

// Safe DOM element text setter - avoids null errors
const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
const setHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

// ════════════════════════════════════════════════════════════════════════════
// COMPLEX ARITHMETIC (with numerical guards)
// ════════════════════════════════════════════════════════════════════════════

// Origin constant - used as safe fallback
const ORIGIN = { re: 0, im: 0 };
Object.freeze(ORIGIN);

// Safe complex constructor - ALWAYS returns valid complex
const C = (re, im = 0) => ({
  re: isValidNumber(re) ? re : 0,
  im: isValidNumber(im) ? im : 0
});

// Bulletproof arithmetic - validate inputs, guarantee valid output
const cadd = (a, b) => {
  if (!a || !b) return ORIGIN;
  const re = a.re + b.re;
  const im = a.im + b.im;
  return { re: isFinite(re) ? re : 0, im: isFinite(im) ? im : 0 };
};

const csub = (a, b) => {
  if (!a || !b) return ORIGIN;
  const re = a.re - b.re;
  const im = a.im - b.im;
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
  const re = a.re * k;
  const im = a.im * k;
  return { re: isFinite(re) ? re : 0, im: isFinite(im) ? im : 0 };
};

const cconj = a => a ? { re: a.re, im: -a.im } : ORIGIN;

const cabs2 = a => {
  if (!a) return 0;
  const r2 = a.re * a.re + a.im * a.im;
  return isFinite(r2) ? r2 : 0;
};

const cabs = a => {
  const r2 = cabs2(a);
  return r2 > 0 ? Math.sqrt(r2) : 0;
};

const carg = a => a ? Math.atan2(a.im, a.re) : 0;

const cpolar = (r, t) => {
  if (!isValidNumber(r) || !isValidNumber(t)) return ORIGIN;
  return { re: r * Math.cos(t), im: r * Math.sin(t) };
};

// Safe complex division with zero check
const cdiv = (a, b) => {
  const d = cabs2(b);
  if (d < EPSILON * EPSILON) {
    // Division by near-zero: return large value in same direction
    const r = cabs(a);
    return r < EPSILON ? C(0, 0) : cscale(cnorm(a), 1e6);
  }
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};

// Safe normalization
const cnorm = a => {
  const r = cabs(a);
  return r < EPSILON ? C(0, 0) : cscale(a, 1 / r);
};

// Safe complex exponential (clamp real part to prevent overflow)
const cexp = a => {
  const clampedRe = clampNumber(a.re, -700, 700); // exp(709) ~ Number.MAX_VALUE
  const r = Math.exp(clampedRe);
  return C(r * Math.cos(a.im), r * Math.sin(a.im));
};

// Safe complex logarithm
const clog = a => {
  const r = cabs(a);
  if (r < EPSILON) return C(-1000, 0); // log(0) ~ -infinity
  return C(Math.log(r), carg(a));
};

// Clamp point to disk interior (with NaN/Infinity handling)
const clampDisk = (z, eps = DISK_BOUNDARY_EPS) => {
  if (!isValidComplex(z)) return C(0, 0);
  const r = cabs(z);
  if (r < EPSILON) return C(0, 0);
  return r >= 1 - eps ? cscale(z, (1 - eps) / r) : z;
};

// Linear interpolation
const lerp = (a, b, t) => a + (b - a) * t;
const clerp = (a, b, t) => C(lerp(a.re, b.re, t), lerp(a.im, b.im, t));

// Smooth easing functions
const ease = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => t * (2 - t),
  inOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  inCubic: t => t * t * t,
  outCubic: t => (--t) * t * t + 1,
  inOutCubic: t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  inExpo: t => t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
  outExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  inOutExpo: t => {
    if (t === 0 || t === 1) return t;
    return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
  }
};

// ════════════════════════════════════════════════════════════════════════════
// HYPERBOLIC GEOMETRY (POINCARÉ DISK MODEL)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Möbius transformation: T_a(z) = (z - a) / (1 - conj(a)·z)
 * Maps point a to origin while preserving hyperbolic structure.
 *
 * Numerical considerations:
 * - When a is near origin, this is nearly identity
 * - When a is near boundary, denominator can be small
 */
function mobius(a, z) {
  // Validate inputs
  if (!isValidComplex(a) || !isValidComplex(z)) return C(0, 0);

  // If a is at origin, return z unchanged
  if (cabs(a) < EPSILON) return z;

  const num = csub(z, a);
  const den = csub(C(1), cmul(cconj(a), z));
  const result = cdiv(num, den);

  // Ensure result stays in disk
  return clampDisk(result);
}

/**
 * Inverse Möbius: T_a^{-1}(w) = (w + a) / (1 + conj(a)·w)
 */
function mobiusInv(a, w) {
  // Validate inputs
  if (!isValidComplex(a) || !isValidComplex(w)) return C(0, 0);

  // If a is at origin, return w unchanged
  if (cabs(a) < EPSILON) return w;

  const num = cadd(w, a);
  const den = cadd(C(1), cmul(cconj(a), w));
  const result = cdiv(num, den);

  // Ensure result stays in disk
  return clampDisk(result);
}

/**
 * Hyperbolic distance between two points.
 * d(z, w) = 2·arctanh(|(z - w) / (1 - conj(z)·w)|)
 *
 * Returns Infinity for points on or outside the boundary.
 * Returns 0 for identical points.
 */
function hypDist(z, w) {
  // Validate inputs
  if (!isValidComplex(z) || !isValidComplex(w)) return Infinity;

  // Same point check
  const diff = csub(z, w);
  if (cabs(diff) < EPSILON) return 0;

  const num = cabs(diff);
  const den = cabs(csub(C(1), cmul(cconj(z), w)));

  // Prevent division by zero
  if (den < EPSILON) return Infinity;

  const ratio = num / den;

  // Clamp ratio to valid atanh domain
  if (ratio >= 1) return Infinity;
  const clampedRatio = Math.min(ratio, MAX_ATANH_ARG);

  return 2 * Math.atanh(clampedRatio);
}

/**
 * Hyperbolic midpoint between two points
 */
function hypMidpoint(z, w) {
  return geodesicLerp(z, w, 0.5);
}

/**
 * Geodesic interpolation - follows shortest hyperbolic path.
 *
 * Algorithm:
 * 1. Transform so z1 maps to origin (via Möbius)
 * 2. In this frame, geodesics through origin are straight lines
 * 3. Interpolate radially using tanh scaling (respects hyperbolic metric)
 * 4. Transform back
 */
function geodesicLerp(z1, z2, t) {
  // Boundary cases
  if (!isValidComplex(z1)) return z2;
  if (!isValidComplex(z2)) return z1;
  if (t <= 0) return z1;
  if (t >= 1) return z2;

  // Clamp t to valid range
  t = clampNumber(t, 0, 1);

  // Transform so z1 is at origin
  const w = mobius(z1, z2);
  const r = cabs(w);

  // If points are essentially the same, return z1
  if (r < EPSILON) return z1;

  // Clamp r for numerical stability in atanh
  const rClamped = Math.min(r, MAX_ATANH_ARG);

  // Interpolate in tanh space (respects hyperbolic metric)
  // tanh(t * atanh(r)) maps [0,1] -> [0,r] along geodesic
  const rInterp = Math.tanh(t * Math.atanh(rClamped));
  const wInterp = cpolar(rInterp, carg(w));

  return clampDisk(mobiusInv(z1, wInterp));
}

/**
 * Compute geodesic arc parameters for rendering.
 * Returns either a line (through origin) or circular arc.
 *
 * Mathematical basis:
 * - Geodesics in Poincaré disk are circular arcs perpendicular to the boundary
 * - Special case: geodesics through origin are straight lines (diameters)
 * - The circle center lies outside the disk
 */
function geodesicArc(z1, z2) {
  // Validate inputs
  if (!isValidComplex(z1) || !isValidComplex(z2)) return null;

  const d = cabs(csub(z1, z2));
  if (d < EPSILON) return null; // Points too close

  // Cross product determines if geodesic passes through origin
  // cross = Im(z1 * conj(z2)) = z1.re*z2.im - z1.im*z2.re
  const cross = z1.re * z2.im - z1.im * z2.re;

  // If cross product is small, geodesic is nearly a diameter
  const LINE_THRESHOLD = 1e-4;
  if (Math.abs(cross) < LINE_THRESHOLD) {
    return { type: 'line', z1, z2 };
  }

  // Compute circle center for geodesic (perpendicular to boundary)
  // The center (cx, cy) satisfies:
  // |z1 - c|² = |z2 - c|² = r² and |c|² - r² = 1
  const r1sq = cabs2(z1), r2sq = cabs2(z2);
  const det = 2 * cross;

  // Check for numerical stability
  if (Math.abs(det) < EPSILON) {
    return { type: 'line', z1, z2 };
  }

  const cx = ((1 + r1sq) * z2.im - (1 + r2sq) * z1.im) / det;
  const cy = ((1 + r2sq) * z1.re - (1 + r1sq) * z2.re) / det;

  // Validate computed center
  if (!isValidNumber(cx) || !isValidNumber(cy)) {
    return { type: 'line', z1, z2 }; // Fallback to line
  }

  const center = C(cx, cy);
  const radius = cabs(csub(z1, center));

  // Sanity check: radius should be positive and center should be outside disk
  if (radius < EPSILON || cabs(center) < 1) {
    return { type: 'line', z1, z2 };
  }

  return { type: 'arc', center, radius, z1, z2 };
}

/**
 * Sample points along a geodesic.
 * Returns array of points for polyline rendering.
 */
function sampleGeodesic(z1, z2, numPoints = 32) {
  // Validate inputs
  if (!isValidComplex(z1) || !isValidComplex(z2)) return [z1 || C(0,0)];
  numPoints = clampNumber(Math.floor(numPoints), 2, 256);

  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const p = geodesicLerp(z1, z2, i / numPoints);
    if (isValidComplex(p)) {
      points.push(p);
    }
  }
  return points.length > 0 ? points : [z1];
}

/**
 * Hyperbolic circle: points at constant hyperbolic distance from center.
 *
 * In Poincaré disk, hyperbolic circles are also Euclidean circles,
 * but with different center and radius:
 * - Euclidean radius: tanh(hypRadius/2) when centered at origin
 * - For off-center circles, use Möbius transformation
 */
function hypCircle(center, hypRadius, segments = 64) {
  // Validate inputs
  if (!isValidComplex(center)) return [];
  hypRadius = Math.max(0, hypRadius);
  segments = clampNumber(Math.floor(segments), 8, 256);

  // Clamp center to disk interior
  center = clampDisk(center);

  // Convert hyperbolic radius to Euclidean radius at origin
  const eucRadius = Math.tanh(clampNumber(hypRadius / 2, 0, 10));

  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    // Create circle at origin, then transform to center
    const p = mobiusInv(center, cpolar(eucRadius, t));
    if (isValidComplex(p)) {
      points.push(clampDisk(p));
    }
  }
  return points;
}

/**
 * Horocycle: circle tangent to boundary at an ideal point.
 * A horocycle is the limit of hyperbolic circles as the center
 * moves to the boundary and the radius grows to infinity.
 *
 * @param idealPoint - Direction of the ideal point (will be normalized)
 * @param eucRadius - Euclidean radius of the horocycle (0 < r < 1)
 */
function horocycle(idealPoint, eucRadius, segments = 64) {
  // Validate inputs
  if (!isValidComplex(idealPoint)) return [];
  eucRadius = clampNumber(eucRadius, 0.01, 0.99);
  segments = clampNumber(Math.floor(segments), 8, 256);

  const dir = cnorm(idealPoint);
  if (cabs(dir) < EPSILON) return []; // Can't determine direction

  // Center is at distance (1 - eucRadius) from origin toward ideal point
  const center = cscale(dir, 1 - eucRadius);

  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const p = cadd(center, cpolar(eucRadius, t));
    if (cabs(p) < 1 - DISK_BOUNDARY_EPS) {
      points.push(clampDisk(p));
    }
  }
  return points;
}

// ════════════════════════════════════════════════════════════════════════════
// HYPERBOLIC GEOMETRY EXTENSIONS
// Advanced algorithms for hyperbolic space manipulation
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hyperbolic reflection across a geodesic.
 * Given a geodesic through p1 and p2, reflects point z.
 */
function hypReflect(z, p1, p2) {
  if (!isValidComplex(z) || !isValidComplex(p1) || !isValidComplex(p2)) return z;

  // Transform so p1 is at origin
  const w = mobius(p1, z);
  const g = mobius(p1, p2);

  // Geodesic through origin is a line - reflect across it
  const angle = carg(g);
  const reflected = cmul(conj(cmul(w, cpolar(1, -angle))), cpolar(1, angle));

  return clampDisk(mobiusInv(p1, reflected));
}

// Note: hypMidpoint is defined above at line 282 - removed duplicate here

/**
 * Perpendicular bisector of geodesic segment.
 * Returns the geodesic that passes through the midpoint
 * and is perpendicular to the segment.
 */
function perpBisector(z1, z2, numPoints = 32) {
  const mid = hypMidpoint(z1, z2);

  // Direction of original geodesic at midpoint
  const delta = csub(z2, z1);
  const dir = carg(delta);

  // Perpendicular direction (rotate 90°)
  const perpDir = dir + Math.PI / 2;

  // Create points along perpendicular geodesic
  const points = [];
  for (let t = -2; t <= 2; t += 4 / numPoints) {
    const offset = cpolar(Math.tanh(Math.abs(t) / 2) * Math.sign(t) * 0.5, perpDir);
    const p = clampDisk(mobiusInv(mid, offset));
    if (cabs(p) < 0.98) points.push(p);
  }
  return points;
}

/**
 * Hyperbolic circumcenter of three points.
 * Uses intersection of perpendicular bisectors (faster than iteration).
 */
function hypCircumcenter(z1, z2, z3) {
  // Get midpoints of two sides
  const m12 = hypMidpoint(z1, z2);
  const m23 = hypMidpoint(z2, z3);

  // If points are nearly collinear, return midpoint of longest side
  const cross = (z2.re - z1.re) * (z3.im - z1.im) - (z2.im - z1.im) * (z3.re - z1.re);
  if (Math.abs(cross) < 0.01) {
    return hypMidpoint(z1, z3);
  }

  // Approximate: use Euclidean circumcenter, then clamp
  // This is fast and good enough for visualization
  const d = 2 * (z1.re * (z2.im - z3.im) + z2.re * (z3.im - z1.im) + z3.re * (z1.im - z2.im));
  if (Math.abs(d) < 0.001) return m12;

  const r1 = cabs2(z1), r2 = cabs2(z2), r3 = cabs2(z3);
  const cx = (r1 * (z2.im - z3.im) + r2 * (z3.im - z1.im) + r3 * (z1.im - z2.im)) / d;
  const cy = (r1 * (z3.re - z2.re) + r2 * (z1.re - z3.re) + r3 * (z2.re - z1.re)) / d;

  return clampDisk(C(cx, cy), 0.05);
}

/**
 * Hyperbolic area of a polygon (vertices given in order).
 * Uses the Gauss-Bonnet theorem: Area = (n-2)π - sum of angles
 */
function hypPolygonArea(vertices) {
  const n = vertices.length;
  if (n < 3) return 0;

  let angleSum = 0;
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i + n - 1) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    // Angle at vertex i
    const a1 = carg(csub(prev, curr));
    const a2 = carg(csub(next, curr));
    let angle = Math.abs(a2 - a1);
    if (angle > Math.PI) angle = 2 * Math.PI - angle;
    angleSum += angle;
  }

  return (n - 2) * Math.PI - angleSum;
}

/**
 * Generate {p,q} hyperbolic tiling.
 * p-gons with q meeting at each vertex.
 * Optimized: numeric hashing, edge limit, early termination.
 */
function generateTiling(p, q, maxGenerations = 3) {
  const edges = [];
  const seen = new Set();
  const MAX_EDGES = 200; // Limit for performance

  // Angle at center of p-gon
  const centralAngle = 2 * Math.PI / p;

  // Hyperbolic radius to vertex (using tiling formula)
  const cosAngle = Math.cos(Math.PI / p);
  const sinAngle = Math.sin(Math.PI / p);
  const cosVertex = Math.cos(Math.PI / q);
  const denom = cosAngle * cosAngle - sinAngle * sinAngle;
  if (denom <= 0) return edges; // Invalid tiling

  const r = Math.sqrt((cosVertex * cosVertex - sinAngle * sinAngle) / denom);
  const eucR = Math.min(0.95, Math.tanh(r / 2));

  // Initial polygon vertices
  const firstPoly = [];
  for (let i = 0; i < p; i++) {
    firstPoly.push(cpolar(eucR, centralAngle * i));
  }

  // Fast numeric hash for polygon (centroid-based)
  const polyHash = vs => {
    let sx = 0, sy = 0;
    for (const v of vs) { sx += v.re; sy += v.im; }
    return Math.round(sx * 100) * 10000 + Math.round(sy * 100);
  };

  // BFS with limits
  const queue = [{ vertices: firstPoly, gen: 0 }];

  while (queue.length > 0 && edges.length < MAX_EDGES) {
    const { vertices, gen } = queue.shift();
    const key = polyHash(vertices);
    if (seen.has(key) || gen > maxGenerations) continue;
    seen.add(key);

    // Add edges
    for (let i = 0; i < vertices.length && edges.length < MAX_EDGES; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      if (cabs(v1) < 0.98 && cabs(v2) < 0.98) {
        edges.push({ start: v1, end: v2 });
      }

      // Reflect for next generation
      if (gen < maxGenerations) {
        const newVerts = vertices.map(v => hypReflect(v, v1, v2));
        queue.push({ vertices: newVerts, gen: gen + 1 });
      }
    }
  }

  return edges;
}

/**
 * Voronoi diagram in hyperbolic space.
 * Simple synchronous computation - only runs when overlay enabled.
 */
function hyperbolicVoronoiDiagram(points, k = 4) {
  if (points.length < 2) return points.map(() => []);

  const n = points.length;
  const cells = [];

  for (let i = 0; i < n; i++) {
    const center = points[i];

    // Find k nearest neighbors
    const neighbors = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      neighbors.push({ idx: j, dist: hypDist(center, points[j]) });
    }
    neighbors.sort((a, b) => a.dist - b.dist);
    const nearest = neighbors.slice(0, Math.min(k, n - 1));

    // Cell vertices are midpoints to neighbors
    const verts = [];
    for (const nb of nearest) {
      const mid = hypMidpoint(center, points[nb.idx]);
      if (cabs(mid) < 0.97) verts.push(mid);
    }

    // Sort by angle around center
    if (verts.length > 1) {
      verts.sort((a, b) =>
        Math.atan2(a.im - center.im, a.re - center.re) -
        Math.atan2(b.im - center.im, b.re - center.re)
      );
    }

    cells.push(verts);
  }

  return cells;
}

/**
 * Parallel transport a vector along a geodesic.
 * Returns array of {point, vector} along the path.
 */
function transportField(startVector, z1, z2, numSteps = 10) {
  const field = [];
  for (let i = 0; i <= numSteps; i++) {
    const t = i / numSteps;
    const point = geodesicLerp(z1, z2, t);

    // In hyperbolic space, parallel transport along geodesics
    // rotates the vector based on the holonomy
    // Approximate: maintain angle relative to geodesic direction
    const nextPoint = geodesicLerp(z1, z2, Math.min(1, t + 0.01));
    const geodesicDir = carg(csub(nextPoint, point));

    // Rotate start vector to align with local geodesic direction
    const startDir = carg(csub(z2, z1));
    const rotation = geodesicDir - startDir;
    const vector = cmul(startVector, cpolar(1, rotation));

    field.push({ point, vector });
  }
  return field;
}

/**
 * Hypercycle: curve equidistant from a geodesic.
 * Unlike geodesics, hypercycles are not straight lines in any model.
 */
function hypercycle(p1, p2, distance, numPoints = 64) {
  const points = [];

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const basePoint = geodesicLerp(p1, p2, t);

    // Get perpendicular direction at this point
    const nextBase = geodesicLerp(p1, p2, Math.min(1, t + 0.01));
    const dir = carg(csub(nextBase, basePoint)) + Math.PI / 2;

    // Move perpendicular by hyperbolic distance
    const offset = cpolar(Math.tanh(distance / 2), dir);
    const point = clampDisk(mobiusInv(basePoint, offset));

    if (cabs(point) < 0.98) points.push(point);
  }

  return points;
}

/**
 * Compute ideal points (points at infinity) for a geodesic.
 * Returns two points on the unit circle.
 */
function idealEndpoints(z1, z2) {
  const arc = geodesicArc(z1, z2);
  if (!arc) return [cpolar(1, 0), cpolar(1, Math.PI)];

  if (arc.type === 'line') {
    // Geodesic through origin - extends to opposite points
    const dir = carg(csub(z2, z1));
    return [cpolar(1, dir), cpolar(1, dir + Math.PI)];
  }

  // Circular arc - find intersections with unit circle
  const cx = arc.center.re, cy = arc.center.im;
  const r = arc.radius;

  // Solve |z - c|² = r² and |z|² = 1
  const a = cx * cx + cy * cy - r * r - 1;
  const b = -2 * cy;

  const discriminant = b * b - 4 * a;
  if (discriminant < 0) {
    // Fallback
    return [cpolar(1, carg(z1)), cpolar(1, carg(z2))];
  }

  const y1 = (-b + Math.sqrt(discriminant)) / 2;
  const y2 = (-b - Math.sqrt(discriminant)) / 2;

  const x1 = Math.sqrt(Math.max(0, 1 - y1 * y1));
  const x2 = Math.sqrt(Math.max(0, 1 - y2 * y2));

  // Determine sign of x from center position
  const ideal1 = C(cx > 0 ? x1 : -x1, y1);
  const ideal2 = C(cx > 0 ? x2 : -x2, y2);

  return [cnorm(ideal1), cnorm(ideal2)];
}

// Export as window.GeometryExtensions for overlays
window.GeometryExtensions = {
  hypReflect,
  hypMidpoint,
  perpBisector,
  hypCircumcenter,
  hypPolygonArea,
  generateTiling,
  hyperbolicVoronoiDiagram,
  transportField,
  hypercycle,
  idealEndpoints,
  hypCircle,
  horocycle,
  geodesicLerp,
  geodesicArc,
  sampleGeodesic,
  hypDist
};

// ════════════════════════════════════════════════════════════════════════════
// DOMAIN DATA GENERATORS
// ════════════════════════════════════════════════════════════════════════════

const DEPTH_COLORS = [
  '#6eb5ff', // 0 - blue
  '#9d8cff', // 1 - indigo
  '#c77dff', // 2 - purple
  '#ff9bce', // 3 - pink
  '#ffb574', // 4 - orange
  '#ffd666', // 5 - yellow
  '#7ee787', // 6 - green
  '#79c0ff', // 7+ - cyan
];

function depthColor(d) {
  return DEPTH_COLORS[Math.min(d, DEPTH_COLORS.length - 1)];
}

const SPACES = {
  hyperbolic: {
    name: 'Hyperbolic Geometry',
    color: '#80ffff',
    icon: 'compass',
    rootIcon: '🌀',
    data: [
      // ═══════════════════════════════════════════════════════════════════════════
      // FUNDAMENTALS - Core concepts of hyperbolic geometry
      // ═══════════════════════════════════════════════════════════════════════════
      { name: 'Fundamentals', icon: '📐', content: 'Core concepts that distinguish hyperbolic geometry from Euclidean.', children: [
        { name: 'Curvature', tags: ['core', 'interactive'], content: 'Hyperbolic space has constant negative Gaussian curvature K = -1. This means triangles have angle sum < 180°.', children: [
          { name: 'Angle Deficit', tags: ['demo'], content: 'In hyperbolic plane, triangle angles sum to less than π. Larger triangles have greater deficit.' },
          { name: 'Area from Angles', tags: ['demo'], content: 'Area of hyperbolic triangle = π - (α + β + γ). This is the Gauss-Bonnet theorem!' },
          { name: 'Saddle Shape', content: 'Locally, hyperbolic space looks like a saddle point - curving up in one direction, down in perpendicular.' },
          { name: 'No Similarity', content: 'Unlike Euclidean, you cannot scale triangles. All similar triangles are congruent!' }
        ]},
        { name: 'Geodesics', tags: ['core', 'interactive'], content: 'Shortest paths between points. In Poincaré disk: circular arcs perpendicular to the boundary.', children: [
          { name: 'Disk Geodesics', tags: ['demo'], content: 'In Poincaré disk: diameters + circular arcs meeting boundary at 90°. Drag nodes to see paths curve!' },
          { name: 'Klein Geodesics', tags: ['demo'], content: 'In Klein model: straight Euclidean lines! But angles are distorted. See the Klein minimap.' },
          { name: 'Half-plane Geodesics', tags: ['demo'], content: 'In upper half-plane: vertical lines + semicircles centered on real axis.' },
          { name: 'Uniqueness', content: 'Exactly one geodesic through any two distinct points. Just like Euclidean, but paths look curved!' }
        ]},
        { name: 'Parallel Lines', tags: ['core', 'interactive'], content: 'Through a point not on a line, infinitely many parallels exist! This violates Euclid\'s 5th postulate.', children: [
          { name: 'Ultra-parallels', tags: ['demo'], content: 'Lines with no common perpendicular. They diverge in both directions.' },
          { name: 'Limiting Parallels', tags: ['demo'], content: 'Lines that meet at infinity (ideal boundary). Asymptotic approach.' },
          { name: 'Angle of Parallelism', tags: ['demo'], content: 'Π(d) = 2·arctan(e^(-d)). Determines parallel angle from distance to line.' }
        ]},
        { name: 'Distance', tags: ['core', 'interactive'], content: 'Hyperbolic distance grows exponentially near boundary. The disk edge is infinitely far!', children: [
          { name: 'Distance Formula', tags: ['demo'], content: 'd(z₁,z₂) = 2·arctanh|z₁-z₂|/|1-z̄₁z₂|. See coordinates panel for live values.' },
          { name: 'Exponential Growth', tags: ['demo'], content: 'Circles of radius r have circumference 2π·sinh(r). Grows exponentially, not linearly!' },
          { name: 'Horocycles', tags: ['demo'], content: 'Circles of infinite radius - curves equidistant from ideal point at infinity.' }
        ]}
      ]},

      // ═══════════════════════════════════════════════════════════════════════════
      // MODELS - Different representations of the same space
      // ═══════════════════════════════════════════════════════════════════════════
      { name: 'Models', icon: '🔮', content: 'Multiple equivalent ways to represent hyperbolic space. Each has different visual trade-offs.', children: [
        { name: 'Poincaré Disk', tags: ['active', 'interactive'], content: 'This view! Unit disk where boundary represents infinity. Conformal (preserves angles).', children: [
          { name: 'Conformal Map', tags: ['property'], content: 'Angles appear correct. Circles map to circles. Ideal for seeing local shape.' },
          { name: 'Geodesic Arcs', tags: ['property'], content: 'Shortest paths are circular arcs meeting boundary at 90°.' },
          { name: 'Boundary at ∞', tags: ['property'], content: 'The unit circle represents points infinitely far away - the "ideal boundary".' }
        ]},
        { name: 'Klein Disk', tags: ['interactive'], content: 'Unit disk where geodesics are straight lines! But angles are distorted. See Klein minimap.', children: [
          { name: 'Straight Geodesics', tags: ['property'], content: 'Shortest paths are Euclidean straight lines. Easy to visualize paths!' },
          { name: 'Angle Distortion', tags: ['property'], content: 'Not conformal - angles appear wrong except at center. Trade-off for straight lines.' },
          { name: 'Same Boundary', tags: ['property'], content: 'Unit circle still represents infinity. Same ideal points as Poincaré.' }
        ]},
        { name: 'Half-Plane', tags: ['interactive'], content: 'Upper half of complex plane. Geodesics are semicircles or vertical lines.', children: [
          { name: 'Real Axis at ∞', tags: ['property'], content: 'The x-axis represents infinity. Also conformal like Poincaré disk.' },
          { name: 'Useful for Tilings', tags: ['property'], content: 'Easier to construct certain tilings. Fundamental domains often simpler.' },
          { name: 'Cayley Transform', tags: ['property'], content: 'Maps disk to half-plane: w = (z-i)/(z+i). Conformal isomorphism.' }
        ]},
        { name: 'Hyperboloid', tags: ['interactive'], content: 'Upper sheet of x² + y² - t² = -1 in Minkowski space. 3D surface in spacetime!', children: [
          { name: 'Minkowski Geometry', tags: ['property'], content: 'Lives in spacetime with signature (-,+,+). Lorentz boosts are rotations!' },
          { name: 'Geodesics as Planes', tags: ['property'], content: 'Geodesics are intersections with planes through origin.' },
          { name: 'Distance from Origin', tags: ['property'], content: 'd(O,p) = arcosh(t). Time coordinate measures hyperbolic distance.' }
        ]}
      ]},

      // ═══════════════════════════════════════════════════════════════════════════
      // TRANSFORMATIONS - How to move in hyperbolic space
      // ═══════════════════════════════════════════════════════════════════════════
      { name: 'Transformations', icon: '🔄', content: 'Isometries of hyperbolic space. Preserve distance, angles, and geodesics.', children: [
        { name: 'Möbius Maps', tags: ['core', 'interactive'], content: 'The camera uses Möbius transformations! z ↦ (z-a)/(1-āz) moves origin to a.', children: [
          { name: 'Translation', tags: ['demo'], content: 'Move origin to point a while preserving geometry. Pan the view to see this!' },
          { name: 'Rotation', tags: ['demo'], content: 'z ↦ e^(iθ)z rotates around origin. Simple multiplication in Poincaré disk.' },
          { name: 'Composition', tags: ['demo'], content: 'Chaining transforms: follow paths, combine rotations. All Möbius maps.' }
        ]},
        { name: 'Parallel Transport', tags: ['core', 'interactive'], content: 'Moving vectors along paths while keeping them "parallel". Reveals curvature!', children: [
          { name: 'Holonomy', tags: ['demo', 'favorite'], content: 'Transport a vector around a closed loop - it rotates! Rotation angle = enclosed area.' },
          { name: 'Path Dependence', tags: ['demo'], content: 'Unlike Euclidean, the result depends on which path you take between points.' },
          { name: 'Geodesic Transport', tags: ['demo'], content: 'Transport along geodesic keeps angle with tangent constant.' }
        ]},
        { name: 'Isometry Groups', tags: ['advanced'], content: 'The symmetry group PSL(2,R) ≅ isometries of H². All distance-preserving maps.', children: [
          { name: 'Elliptic', tags: ['type'], content: 'Rotations around a point. One fixed point inside disk.' },
          { name: 'Parabolic', tags: ['type'], content: 'One fixed point on boundary. "Rotation around infinity".' },
          { name: 'Hyperbolic', tags: ['type'], content: 'Translation along a geodesic. Two fixed points on boundary.' }
        ]}
      ]},

      // ═══════════════════════════════════════════════════════════════════════════
      // TILINGS - Regular tessellations of hyperbolic plane
      // ═══════════════════════════════════════════════════════════════════════════
      { name: 'Tilings', icon: '🔷', content: 'Regular tilings {p,q}: p-gons meeting q at each vertex. Infinitely many possibilities!', children: [
        { name: '{7,3} Heptagon', tags: ['demo', 'favorite'], content: 'Seven-sided regular polygons, 3 meeting at each vertex. The "most hyperbolic" look.', children: [
          { name: 'Angle Sum', content: '7 angles of 2π/3 each. Total 14π/3 > 2π means negative curvature.' },
          { name: 'Symmetry Group', content: 'Triangle group (2,3,7). Hyperbolic reflections generate all symmetries.' }
        ]},
        { name: '{5,4} Pentagon', tags: ['demo'], content: 'Regular pentagons, 4 meeting at each vertex. Striking visual pattern.', children: [
          { name: 'Angle Math', content: '4 × (108°) = 432° > 360°. Impossible in Euclidean, natural in hyperbolic.' },
          { name: 'Dual Tiling', content: 'Dual is {4,5}: squares with 5 at each vertex.' }
        ]},
        { name: '{4,5} Square', tags: ['demo'], content: 'Squares with 5 meeting at each vertex. More squares than Euclidean allows!', children: [
          { name: 'Right Angles', content: 'Each angle is exactly 90°, but 5 fit around a vertex (not 4 like Euclidean).' },
          { name: 'Chess Pattern', content: 'Can 2-color like checkerboard. Hyperbolic chess!' }
        ]},
        { name: '{3,7} Triangle', tags: ['demo'], content: 'Equilateral triangles, 7 meeting at each vertex. Densely packed!', children: [
          { name: 'Small Triangles', content: 'Each triangle has area π - 3×(2π/7) = π/7. Tiny tiles!' },
          { name: 'Fractal-like', content: 'Visually similar at all scales due to self-similarity of hyperbolic space.' }
        ]},
        { name: '{∞,3} Apeirogon', tags: ['demo', 'advanced'], content: 'Infinite-sided polygons (horocycles) meeting 3 at each vertex.', children: [
          { name: 'Ideal Vertices', content: 'Vertices lie on ideal boundary at infinity.' },
          { name: 'Zero Angles', content: 'Interior angles are 0! Sides are limiting parallel.' }
        ]}
      ]},

      // ═══════════════════════════════════════════════════════════════════════════
      // APPLICATIONS - Real-world uses of hyperbolic geometry
      // ═══════════════════════════════════════════════════════════════════════════
      { name: 'Applications', icon: '🚀', content: 'Hyperbolic geometry appears in many modern applications.', children: [
        { name: 'ML Embeddings', tags: ['hot', 'research'], content: 'Poincaré embeddings for hierarchical data. Trees embed with low distortion!', children: [
          { name: 'Hierarchical Data', tags: ['use-case'], content: 'Taxonomies, org charts, knowledge graphs naturally fit hyperbolic space.' },
          { name: 'Low Distortion', tags: ['property'], content: 'Trees embed with O(log n) distortion vs O(n) in Euclidean.' },
          { name: 'Poincaré Ball', content: 'Generalizes to higher dimensions. Used in hyperbolic neural networks.' }
        ]},
        { name: 'Visualization', tags: ['active', 'interactive'], content: 'This app! Hyperbolic trees show more context than Euclidean layouts.', children: [
          { name: 'Focus + Context', tags: ['technique'], content: 'Center node large, context preserved. Navigate without losing structure.' },
          { name: 'Exponential Space', tags: ['property'], content: 'Boundary area grows exponentially. Fits more nodes than Euclidean circle.' },
          { name: 'Tree Layouts', tags: ['technique'], content: 'Perfect for hierarchies. Each subtree gets equal hyperbolic area.' }
        ]},
        { name: 'Special Relativity', tags: ['physics'], content: 'Velocity addition in SR is hyperbolic! Rapidity adds like hyperbolic distance.', children: [
          { name: 'Rapidity', tags: ['concept'], content: 'θ = arctanh(v/c). Rapidities add linearly, velocities don\'t.' },
          { name: 'Velocity Space', tags: ['concept'], content: 'Set of all velocities forms hyperbolic ball (radius c).' }
        ]},
        { name: 'Escher Art', tags: ['art', 'favorite'], content: 'M.C. Escher\'s Circle Limit series are hyperbolic tilings!', children: [
          { name: 'Circle Limit I', tags: ['artwork'], content: 'Fish tiling based on {6,4} pattern.' },
          { name: 'Circle Limit III', tags: ['artwork'], content: 'Famous fish following geodesics.' },
          { name: 'Circle Limit IV', tags: ['artwork'], content: 'Angels and devils {6,4} dual coloring.' }
        ]},
        { name: 'Crochet & Coral', tags: ['nature'], content: 'Hyperbolic surfaces in the physical world: lettuce, coral, crochet models.', children: [
          { name: 'Hyperbolic Crochet', tags: ['craft'], content: 'Daina Taimina\'s technique: increase stitches at regular rate.' },
          { name: 'Coral Reefs', tags: ['biology'], content: 'Coral grows in hyperbolic-like ruffled surfaces to maximize area.' }
        ]}
      ]}
    ]
  },

  infra: {
    name: 'Infrastructure',
    color: '#7ee787',
    icon: 'server',
    rootIcon: '🖥️',
    data: [
      { name: 'Production', icon: '🌐', content: 'Live production environment. Handle with care.', children: [
        { name: 'Load Balancers', content: 'Distribute traffic across web cluster. Active-passive failover.', children: [
          { name: 'nginx-lb-01', tags: ['active', 'healthy'], content: 'Primary LB. 10.0.1.10. Handles 80% of traffic.', action: 'showLoadBalancerStats' },
          { name: 'nginx-lb-02', tags: ['standby', 'healthy'], content: 'Secondary LB. 10.0.1.11. Ready for failover.', action: 'showLoadBalancerStats' },
          { name: 'haproxy-03', tags: ['backup'], content: 'Backup LB. 10.0.1.12. Used during maintenance.', action: 'showLoadBalancerStats' }
        ]},
        { name: 'Web Cluster', content: 'Frontend servers. Auto-scaling group.', children: [
          { name: 'web-prod-01', tags: ['healthy', 'primary'], content: 'Primary web. 4 CPU, 8GB RAM. Handles SSR.' },
          { name: 'web-prod-02', tags: ['healthy'], content: 'Web node 2. 10.0.2.12.' },
          { name: 'web-prod-03', tags: ['healthy'], content: 'Web node 3. 10.0.2.13.' },
          { name: 'web-prod-04', tags: ['degraded', 'warning'], content: 'High memory usage (87%). Consider restart.' }
        ]},
        { name: 'API Services', content: 'Microservices backend. Kubernetes pods.', children: [
          { name: 'api-gateway', tags: ['healthy', 'critical'], content: 'Kong gateway. Rate limiting, auth. 50k req/min capacity.' },
          { name: 'auth-service', tags: ['healthy', 'critical'], content: 'JWT auth, OAuth. Redis session store.' },
          { name: 'user-service', tags: ['healthy'], content: 'User CRUD, profiles. PostgreSQL backend.' },
          { name: 'payment-service', tags: ['healthy', 'critical'], content: 'Stripe integration. PCI compliant.' },
          { name: 'notification-svc', tags: ['healthy'], content: 'Email, SMS, push. Queue-based delivery.' },
          { name: 'search-service', tags: ['healthy'], content: 'Elasticsearch-backed. Full-text search.' }
        ]},
        { name: 'Databases', content: 'Data layer. Primary-replica setup.', children: [
          { name: 'postgres-primary', tags: ['healthy', 'critical', 'primary'], content: 'Main DB. 16 CPU, 64GB RAM. 500GB SSD. Daily backups.', action: 'showDatabaseStats' },
          { name: 'postgres-replica-01', tags: ['healthy', 'replica'], content: 'Read replica. Streaming replication. 2s lag.', action: 'showDatabaseStats' },
          { name: 'postgres-replica-02', tags: ['healthy', 'replica'], content: 'Read replica. US-West region.', action: 'showDatabaseStats' },
          { name: 'redis-cache-01', tags: ['healthy'], content: 'Session cache. 16GB. Cluster mode.', action: 'showCacheStats' },
          { name: 'redis-cache-02', tags: ['healthy'], content: 'Application cache. 16GB.', action: 'showCacheStats' },
          { name: 'elasticsearch-01', tags: ['healthy'], content: 'Search index. 3-node cluster. 200GB data.', action: 'checkServiceHealth' }
        ]}
      ]},
      { name: 'Staging', icon: '🧪', content: 'Pre-production testing environment.', children: [
        { name: 'staging-web-01', tags: ['healthy'], content: 'Staging frontend. Same config as prod.' },
        { name: 'staging-api', tags: ['healthy'], content: 'All services in single pod for testing.' },
        { name: 'staging-db', tags: ['healthy'], content: 'Sanitized prod data copy. Refreshed weekly.' },
        { name: 'staging-redis', tags: ['healthy'], content: 'Shared cache instance.' }
      ]},
      { name: 'Development', icon: '🛠️', content: 'Local dev and testing infrastructure.', children: [
        { name: 'dev-cluster', tags: ['healthy'], content: 'K3s cluster for local testing.' },
        { name: 'dev-db', tags: ['healthy'], content: 'PostgreSQL 15 with sample data.' },
        { name: 'localstack', tags: ['healthy'], content: 'AWS service emulation. S3, SQS, DynamoDB.' }
      ]},
      { name: 'Monitoring', icon: '📊', content: 'Observability stack. Metrics, logs, traces.', children: [
        { name: 'prometheus', tags: ['healthy', 'critical'], content: 'Metrics collection. 15s scrape interval. 30d retention.', action: 'openPrometheusMetrics' },
        { name: 'grafana', tags: ['healthy'], content: 'Dashboards and alerts. 50+ panels.', action: 'openGrafanaDashboard' },
        { name: 'alertmanager', tags: ['healthy'], content: 'Alert routing. PagerDuty, Slack integration.', action: 'checkServiceHealth' },
        { name: 'loki', tags: ['healthy'], content: 'Log aggregation. 7d retention.', action: 'checkServiceHealth' },
        { name: 'jaeger', tags: ['healthy'], content: 'Distributed tracing. 1% sampling rate.', action: 'checkServiceHealth' }
      ]},
      { name: 'CI/CD', icon: '🔄', content: 'Build and deployment pipelines.', children: [
        { name: 'jenkins-master', tags: ['healthy'], content: 'Build orchestrator. 100+ jobs defined.', action: 'openJenkinsJob' },
        { name: 'jenkins-agent-01', tags: ['healthy', 'busy'], content: 'Build agent. Currently running main pipeline.', action: 'checkServiceHealth' },
        { name: 'jenkins-agent-02', tags: ['healthy', 'idle'], content: 'Build agent. Available for jobs.', action: 'checkServiceHealth' },
        { name: 'harbor-registry', tags: ['healthy'], content: 'Container registry. 50GB images. Vulnerability scanning.', action: 'checkServiceHealth' },
        { name: 'argocd', tags: ['healthy'], content: 'GitOps deployments. Auto-sync enabled.', action: 'openArgoCD' }
      ]}
    ]
  },

  github: {
    name: 'GitHub Projects',
    color: '#6eb5ff',
    icon: 'github',
    rootIcon: '🐙',
    data: [
      { name: 'umbra', icon: '📦', tags: ['active'], children: [
        { name: 'Issues', children: [
          { name: '#156 Add hyperbolic zoom', tags: ['enhancement', 'p1'] },
          { name: '#154 Memory leak in renderer', tags: ['bug', 'critical'] },
          { name: '#152 Dark mode improvements', tags: ['enhancement'] },
          { name: '#148 Mobile touch support', tags: ['enhancement', 'p2'] },
          { name: '#145 Update dependencies', tags: ['maintenance'] }
        ]},
        { name: 'Pull Requests', children: [
          { name: 'PR #157 feat: geodesic paths', tags: ['feature', 'review'] },
          { name: 'PR #155 fix: memory leak', tags: ['bugfix', 'approved'] },
          { name: 'PR #153 refactor: renderer', tags: ['refactor', 'draft'] }
        ]},
        { name: 'Branches', children: [
          { name: 'main', tags: ['protected', 'default'] },
          { name: 'develop', tags: ['active'] },
          { name: 'feature/hyperbolic-v3', tags: ['wip'] },
          { name: 'hotfix/memory-leak', tags: ['urgent'] }
        ]},
        { name: 'Actions', children: [
          { name: 'CI Pipeline', tags: ['passing'] },
          { name: 'Deploy Preview', tags: ['passing'] },
          { name: 'Deploy Production', tags: ['manual'] }
        ]}
      ]},
      { name: 'api-toolkit', icon: '🔧', children: [
        { name: 'Issues', children: [
          { name: '#89 Rate limiting', tags: ['enhancement'] },
          { name: '#87 TypeScript types', tags: ['types'] },
          { name: '#85 Caching layer', tags: ['enhancement', 'p1'] }
        ]},
        { name: 'Pull Requests', children: [
          { name: 'PR #90 feat: caching', tags: ['feature'] },
          { name: 'PR #88 types: improve', tags: ['types', 'approved'] }
        ]}
      ]},
      { name: 'ml-experiments', icon: '🧠', tags: ['research'], children: [
        { name: 'Models', children: [
          { name: 'transformer-v3', tags: ['training', 'gpu'] },
          { name: 'vision-encoder', tags: ['deployed'] },
          { name: 'rl-agent-v2', tags: ['testing'] }
        ]},
        { name: 'Datasets', children: [
          { name: 'imagenet-subset', tags: ['large'] },
          { name: 'custom-text-corpus', tags: ['proprietary'] },
          { name: 'synthetic-graphs', tags: ['generated'] }
        ]},
        { name: 'Experiments', children: [
          { name: 'exp-2026-01-15', tags: ['running'] },
          { name: 'exp-2026-01-14', tags: ['completed', 'promising'] },
          { name: 'exp-2026-01-13', tags: ['completed'] }
        ]}
      ]},
      { name: 'dotfiles', icon: '⚙️', children: [
        { name: 'neovim', tags: ['config'] },
        { name: 'zsh', tags: ['config'] },
        { name: 'tmux', tags: ['config'] },
        { name: 'git', tags: ['config'] },
        { name: 'alacritty', tags: ['config'] }
      ]}
    ]
  },

  notes: {
    name: 'Notes & Ideas',
    color: '#ffb574',
    icon: 'file-text',
    rootIcon: '💡',
    data: [
      { name: 'Projects', icon: '🎯', children: [
        { name: 'Hyperbolic UI', tags: ['active', 'favorite'], children: [
          { name: 'Poincaré disk math', tags: ['research', 'done'] },
          { name: 'Möbius transforms', tags: ['implementation', 'done'] },
          { name: 'Geodesic rendering', tags: ['implementation', 'wip'] },
          { name: 'Performance optimization', tags: ['todo'] },
          { name: 'Touch gestures', tags: ['todo'] }
        ]},
        { name: 'Knowledge Graph', tags: ['idea'], children: [
          { name: 'Entity extraction', tags: ['research'] },
          { name: 'Relationship inference', tags: ['research'] },
          { name: 'Visualization layer', tags: ['design'] }
        ]},
        { name: 'CLI Tools', children: [
          { name: 'Task runner', tags: ['done'] },
          { name: 'Git helpers', tags: ['wip'] },
          { name: 'Project scaffolder', tags: ['idea'] }
        ]}
      ]},
      { name: 'Ideas', icon: '💭', children: [
        { name: 'Spatial computing interfaces', tags: ['future', 'favorite'] },
        { name: 'AI-assisted coding workflows', tags: ['research'] },
        { name: 'Collaborative knowledge bases', tags: ['idea'] },
        { name: 'Visual programming languages', tags: ['idea'] },
        { name: 'Generative UI systems', tags: ['research', 'hot'] }
      ]},
      { name: 'Reading List', icon: '📚', children: [
        { name: 'Books', children: [
          { name: 'Designing Data-Intensive Apps', tags: ['reading', 'important'] },
          { name: 'SICP', tags: ['classic', 'todo'] },
          { name: 'Category Theory for Programmers', tags: ['advanced', 'todo'] },
          { name: 'The Art of Doing Science', tags: ['done', 'favorite'] }
        ]},
        { name: 'Papers', children: [
          { name: 'Attention Is All You Need', tags: ['done', 'classic'] },
          { name: 'Hyperbolic Neural Networks', tags: ['reading', 'relevant'] },
          { name: 'Poincaré Embeddings', tags: ['done', 'relevant'] }
        ]},
        { name: 'Articles', children: [
          { name: 'Hyperbolic geometry intro', tags: ['done'] },
          { name: 'WebGPU tutorial series', tags: ['reading'] },
          { name: 'Rust async patterns', tags: ['todo'] }
        ]}
      ]},
      { name: 'Journal', icon: '📓', children: [
        { name: '2026-01-15', tags: ['today'], children: [
          { name: 'Morning standup notes' },
          { name: 'Hyperbolic UI progress' },
          { name: 'Ideas for improvements' }
        ]},
        { name: '2026-01-14', tags: ['yesterday'], children: [
          { name: 'Code review feedback' },
          { name: 'Performance profiling' }
        ]},
        { name: '2026-01-13', children: [
          { name: 'Initial prototype' },
          { name: 'Research notes' }
        ]}
      ]},

      // ═══════════════════════════════════════════════════════════════════════════
      // FEATURE ROADMAP - Each item scoped to ~1 hour of implementation
      // ═══════════════════════════════════════════════════════════════════════════
      { name: 'Feature Roadmap', icon: '🗺️', tags: ['planning', 'live'], content: 'Each feature is scoped to roughly one hour of focused implementation.', children: [

        // ─────────────────────────────────────────────────────────────────────────
        // NAVIGATION & INTERACTION
        // ─────────────────────────────────────────────────────────────────────────
        { name: 'Navigation', icon: '🧭', children: [
          { name: 'Keyboard focus ring', tags: ['1h', 'accessibility'], content: 'Visual indicator showing which node has keyboard focus. Tab/Shift+Tab to move.' },
          { name: 'Minimap click-to-pan', tags: ['1h', 'interaction'], content: 'Click anywhere on minimap to center main view on that location.' },
          { name: 'Double-click to focus', tags: ['30m', 'interaction'], content: 'Double-click a node to focus and expand its subtree.' },
          { name: 'Breadcrumb drag-reorder', tags: ['1h', 'interaction'], content: 'Drag breadcrumb chips to reorder navigation path.' },
          { name: 'Swipe gestures (mobile)', tags: ['1h', 'mobile'], content: 'Two-finger swipe for history back/forward, pinch for zoom.' },
          { name: 'Animated zoom to selection', tags: ['45m', 'animation'], content: 'Smooth geodesic animation when zooming to selected node.' },
          { name: 'Edge-of-screen panning', tags: ['30m', 'interaction'], content: 'Move cursor to edge to pan in that direction.' },
          { name: 'Home position memory', tags: ['30m', 'state'], content: 'Remember and restore last view position per space.' }
        ]},

        // ─────────────────────────────────────────────────────────────────────────
        // NODE OPERATIONS
        // ─────────────────────────────────────────────────────────────────────────
        { name: 'Node Operations', icon: '📦', children: [
          { name: 'Inline node rename', tags: ['1h', 'editing'], content: 'Press R to rename in-place with text input overlay.' },
          { name: 'Quick node creation', tags: ['1h', 'editing'], content: 'Press N to create child of focused node with name prompt.' },
          { name: 'Drag-to-reparent', tags: ['1h', 'editing'], content: 'Drag a node onto another to change its parent.' },
          { name: 'Multi-select operations', tags: ['1h', 'bulk'], content: 'Delete, tag, or move multiple selected nodes at once.' },
          { name: 'Copy/paste subtree', tags: ['1h', 'editing'], content: 'Cmd+C to copy subtree, Cmd+V to paste as children of focused.' },
          { name: 'Node templates', tags: ['1h', 'productivity'], content: 'Save node structures as templates, insert with hotkey.' },
          { name: 'Undo/redo stack', tags: ['1h', 'core'], content: 'Cmd+Z / Cmd+Shift+Z for graph operations.' },
          { name: 'Node duplication', tags: ['30m', 'editing'], content: 'Cmd+D to duplicate selected node and children.' }
        ]},

        // ─────────────────────────────────────────────────────────────────────────
        // VISUAL CUSTOMIZATION
        // ─────────────────────────────────────────────────────────────────────────
        { name: 'Visual Customization', icon: '🎨', children: [
          { name: 'Custom node colors', tags: ['1h', 'styling'], content: 'Color picker for individual nodes, override depth coloring.' },
          { name: 'Node icons/emojis', tags: ['45m', 'styling'], content: 'Emoji picker or icon selector per node.' },
          { name: 'Edge thickness by weight', tags: ['45m', 'visual'], content: 'Thicker edges for stronger relationships.' },
          { name: 'Label font size scaling', tags: ['30m', 'visual'], content: 'Larger fonts for important/tagged nodes.' },
          { name: 'Depth color palette editor', tags: ['1h', 'styling'], content: 'Custom gradient for depth coloring.' },
          { name: 'Node shape variants', tags: ['1h', 'visual'], content: 'Circles, squares, diamonds based on node type.' },
          { name: 'Animated node entrance', tags: ['45m', 'animation'], content: 'Fade/scale in when nodes become visible.' },
          { name: 'Grid style options', tags: ['30m', 'visual'], content: 'Dotted, dashed, solid grid lines.' }
        ]},

        // ─────────────────────────────────────────────────────────────────────────
        // SEARCH & FILTER
        // ─────────────────────────────────────────────────────────────────────────
        { name: 'Search & Filter', icon: '🔍', children: [
          { name: 'Tag filtering', tags: ['1h', 'filter'], content: 'Show only nodes with specific tags, hide others.' },
          { name: 'Depth filter slider', tags: ['45m', 'filter'], content: 'Slider to show only nodes up to N levels deep.' },
          { name: 'Search highlight persist', tags: ['30m', 'search'], content: 'Keep search results highlighted after closing palette.' },
          { name: 'Regex search', tags: ['45m', 'search'], content: 'Toggle regex mode in command palette search.' },
          { name: 'Search history', tags: ['30m', 'search'], content: 'Show recent searches in command palette.' },
          { name: 'Content search', tags: ['1h', 'search'], content: 'Search within node content, not just names.' },
          { name: 'Cross-space search', tags: ['1h', 'search'], content: 'Search across all spaces, show results grouped.' },
          { name: 'Save search as filter', tags: ['45m', 'filter'], content: 'Save search query as reusable filter.' }
        ]},

        // ─────────────────────────────────────────────────────────────────────────
        // DATA & PERSISTENCE
        // ─────────────────────────────────────────────────────────────────────────
        { name: 'Data & Persistence', icon: '💾', children: [
          { name: 'Auto-save to localStorage', tags: ['1h', 'persistence'], content: 'Automatically save graph changes locally.' },
          { name: 'IndexedDB storage', tags: ['1h', 'persistence'], content: 'Store large graphs in IndexedDB for better performance.' },
          { name: 'JSON export/import', tags: ['45m', 'data'], content: 'Export current space as JSON, import to restore.' },
          { name: 'Markdown export', tags: ['1h', 'export'], content: 'Export subtree as nested markdown list.' },
          { name: 'OPML import', tags: ['1h', 'import'], content: 'Import outline from OPML format.' },
          { name: 'CSV node list export', tags: ['30m', 'export'], content: 'Export flat list of nodes with properties.' },
          { name: 'Bookmark sync', tags: ['1h', 'sync'], content: 'Sync bookmarks across devices via external service.' },
          { name: 'Version snapshots', tags: ['1h', 'versioning'], content: 'Save named snapshots of graph state.' }
        ]},

        // ─────────────────────────────────────────────────────────────────────────
        // GEOMETRY & RENDERING
        // ─────────────────────────────────────────────────────────────────────────
        { name: 'Geometry & Rendering', icon: '📐', children: [
          { name: 'Half-plane projection', tags: ['1h', 'geometry'], content: 'Alternative Poincaré half-plane view mode.' },
          { name: 'Klein disk toggle', tags: ['45m', 'geometry'], content: 'Switch to Klein model where geodesics are straight.' },
          { name: 'Geodesic arc labeling', tags: ['45m', 'visual'], content: 'Show hyperbolic distance on edge hover.' },
          { name: 'Curvature heat map', tags: ['1h', 'visual'], content: 'Visualize local node density as color intensity.' },
          { name: 'WebGL renderer', tags: ['1h', 'performance'], content: 'GPU-accelerated rendering for large graphs.' },
          { name: 'LOD for dense regions', tags: ['1h', 'performance'], content: 'Simplify rendering in dense areas until zoomed.' },
          { name: 'Frustum culling improvements', tags: ['45m', 'performance'], content: 'Better visibility testing for edge culling.' },
          { name: 'Anti-aliased edges', tags: ['30m', 'visual'], content: 'Smoother edge rendering using stroke techniques.' }
        ]},

        // ─────────────────────────────────────────────────────────────────────────
        // COLLABORATION & SHARING
        // ─────────────────────────────────────────────────────────────────────────
        { name: 'Collaboration', icon: '👥', children: [
          { name: 'URL state encoding', tags: ['1h', 'sharing'], content: 'Encode view position and focus in URL hash.' },
          { name: 'Share link generator', tags: ['45m', 'sharing'], content: 'Generate shareable link to current view.' },
          { name: 'Screenshot capture', tags: ['1h', 'export'], content: 'Export canvas as PNG/SVG image.' },
          { name: 'Embed mode', tags: ['45m', 'embed'], content: 'Minimal chrome mode for embedding in other pages.' },
          { name: 'Print-friendly view', tags: ['45m', 'export'], content: 'High contrast, no animations for printing.' },
          { name: 'Annotation mode', tags: ['1h', 'collaboration'], content: 'Add floating notes attached to canvas positions.' },
          { name: 'Presentation mode', tags: ['1h', 'presentation'], content: 'Step through nodes in sequence with transitions.' },
          { name: 'Export to Mermaid', tags: ['45m', 'export'], content: 'Generate Mermaid diagram syntax from subtree.' }
        ]},

        // ─────────────────────────────────────────────────────────────────────────
        // INTEGRATIONS
        // ─────────────────────────────────────────────────────────────────────────
        { name: 'Integrations', icon: '🔗', children: [
          { name: 'GitHub issues sync', tags: ['1h', 'integration'], content: 'Fetch and display GitHub issues as nodes.' },
          { name: 'Markdown file watcher', tags: ['1h', 'integration'], content: 'Auto-import markdown files from directory.' },
          { name: 'Obsidian vault import', tags: ['1h', 'import'], content: 'Import Obsidian vault structure as graph.' },
          { name: 'Notion database sync', tags: ['1h', 'integration'], content: 'Two-way sync with Notion database.' },
          { name: 'REST API for graph', tags: ['1h', 'api'], content: 'HTTP endpoints to query and modify graph.' },
          { name: 'Webhook on changes', tags: ['1h', 'integration'], content: 'POST to URL when graph is modified.' },
          { name: 'Calendar view', tags: ['1h', 'integration'], content: 'Show date-tagged nodes on timeline.' },
          { name: 'RSS feed import', tags: ['45m', 'import'], content: 'Create nodes from RSS feed items.' }
        ]},

        // ─────────────────────────────────────────────────────────────────────────
        // ANALYSIS & INSIGHTS
        // ─────────────────────────────────────────────────────────────────────────
        { name: 'Analysis', icon: '📊', children: [
          { name: 'Node statistics panel', tags: ['1h', 'analysis'], content: 'Show degree, depth, subtree size for selected node.' },
          { name: 'Graph metrics dashboard', tags: ['1h', 'analysis'], content: 'Overall stats: node count, max depth, density.' },
          { name: 'Orphan node finder', tags: ['30m', 'analysis'], content: 'Highlight nodes with no children or parents.' },
          { name: 'Duplicate detection', tags: ['45m', 'analysis'], content: 'Find nodes with similar names.' },
          { name: 'Path finding', tags: ['1h', 'analysis'], content: 'Find shortest path between any two nodes.' },
          { name: 'Cluster detection', tags: ['1h', 'analysis'], content: 'Identify densely connected subgraphs.' },
          { name: 'Tag cloud', tags: ['45m', 'visual'], content: 'Show tag frequency as word cloud.' },
          { name: 'Activity timeline', tags: ['1h', 'analysis'], content: 'When nodes were created/modified over time.' }
        ]},

        // ─────────────────────────────────────────────────────────────────────────
        // ACCESSIBILITY
        // ─────────────────────────────────────────────────────────────────────────
        { name: 'Accessibility', icon: '♿', children: [
          { name: 'Screen reader labels', tags: ['1h', 'a11y'], content: 'ARIA labels for all interactive elements.' },
          { name: 'High contrast mode', tags: ['45m', 'a11y'], content: 'Increased contrast for visibility.' },
          { name: 'Reduced motion mode', tags: ['30m', 'a11y'], content: 'Disable animations for vestibular sensitivity.' },
          { name: 'Keyboard navigation help', tags: ['30m', 'a11y'], content: 'Accessible keyboard shortcuts overlay.' },
          { name: 'Focus trap in modals', tags: ['30m', 'a11y'], content: 'Keep focus within open modal dialogs.' },
          { name: 'Color blind friendly', tags: ['1h', 'a11y'], content: 'Alternative color schemes for color blindness.' }
        ]},

        // ─────────────────────────────────────────────────────────────────────────
        // PERFORMANCE
        // ─────────────────────────────────────────────────────────────────────────
        { name: 'Performance', icon: '⚡', children: [
          { name: 'Worker thread layout', tags: ['1h', 'perf'], content: 'Run force-directed layout in Web Worker.' },
          { name: 'Virtual scrolling in lists', tags: ['1h', 'perf'], content: 'Only render visible items in bookmark list.' },
          { name: 'Lazy load deep nodes', tags: ['1h', 'perf'], content: 'Load children on demand when expanding.' },
          { name: 'Request animation batching', tags: ['45m', 'perf'], content: 'Batch DOM updates to reduce reflows.' },
          { name: 'Memory profiling', tags: ['45m', 'perf'], content: 'Add tools to monitor memory usage.' },
          { name: 'Incremental rendering', tags: ['1h', 'perf'], content: 'Render visible nodes first, then fill in.' }
        ]}
      ]}
    ]
  },

  math: {
    name: 'Formal',
    color: '#ff9bce',
    icon: 'function',
    rootIcon: '∀',
    data: [
      { name: 'Condensed Mathematics', icon: '🧊', tags: ['frontier'], children: [
        { name: 'Foundations', children: [
          { name: 'Pyknotic Sets', tags: ['core'] },
          { name: 'Condensed Sets', tags: ['core'] },
          { name: 'Solid Modules', tags: ['advanced'] },
          { name: 'Liquid Vector Spaces', tags: ['advanced'] },
          { name: 'Analytic Geometry', tags: ['frontier'] }
        ]},
        { name: 'Clausen-Scholze Program', children: [
          { name: 'Liquid Tensor Experiment', tags: ['landmark'] },
          { name: 'Condensed Cohomology' },
          { name: 'Six Functor Formalism' },
          { name: 'Nuclear Modules' }
        ]},
        { name: 'Connections', children: [
          { name: 'Perfectoid Spaces' },
          { name: 'p-adic Hodge Theory' },
          { name: 'Derived Categories' },
          { name: 'Infinity Categories', tags: ['hott'] }
        ]}
      ]},

      { name: 'Proof Assistants', icon: '✓', tags: ['tools'], children: [
        { name: 'Lean 4', tags: ['hot', 'favorite'], children: [
          { name: 'Mathlib4', tags: ['core'] },
          { name: 'Type Classes' },
          { name: 'Tactics DSL' },
          { name: 'Metaprogramming' },
          { name: 'Lake Build System' }
        ]},
        { name: 'Coq', children: [
          { name: 'Ltac2' },
          { name: 'Mathematical Components' },
          { name: 'Program Extraction' },
          { name: 'UniMath', tags: ['hott'] }
        ]},
        { name: 'Isabelle/HOL', children: [
          { name: 'Archive of Formal Proofs' },
          { name: 'Sledgehammer' },
          { name: 'Isar Proofs' }
        ]},
        { name: 'Agda', children: [
          { name: 'Cubical Agda', tags: ['hott'] },
          { name: 'Dependent Pattern Matching' },
          { name: '1lab', tags: ['hott'] }
        ]},
        { name: 'Landmark Formalizations', tags: ['milestone'], children: [
          { name: 'Liquid Tensor (Lean)', tags: ['landmark'] },
          { name: 'Perfectoid Spaces (Lean)' },
          { name: 'Four Color Theorem (Coq)' },
          { name: 'Kepler Conjecture (HOL)' },
          { name: 'Odd Order Theorem (Coq)' },
          { name: 'Sphere Eversion (Lean)', tags: ['recent'] }
        ]}
      ]},

      { name: 'Tensor Computation', icon: '⊗', children: [
        { name: 'Notation & Abstraction', children: [
          { name: 'Einstein Summation', tags: ['core'] },
          { name: 'Index Notation' },
          { name: 'Abstract Index Notation' },
          { name: 'Penrose Graphical Notation' }
        ]},
        { name: 'Tensor Networks', children: [
          { name: 'Matrix Product States', tags: ['physics'] },
          { name: 'PEPS' },
          { name: 'MERA' },
          { name: 'Tensor Decompositions', tags: ['core'] }
        ]},
        { name: 'Automatic Differentiation', children: [
          { name: 'Forward Mode' },
          { name: 'Reverse Mode (Backprop)', tags: ['core'] },
          { name: 'Jacobian-Vector Products' },
          { name: 'Higher-Order AD' },
          { name: 'Source Transformation' }
        ]},
        { name: 'Computational Graphs', children: [
          { name: 'Static Graphs (XLA)' },
          { name: 'Dynamic Graphs (PyTorch)' },
          { name: 'Graph Compilers', tags: ['infra'] },
          { name: 'Fusion & Scheduling' }
        ]}
      ]},

      { name: 'Deep Learning Theory', icon: '🧠', children: [
        { name: 'Architectures', children: [
          { name: 'Transformers', tags: ['core', 'hot'] },
          { name: 'Attention Mechanisms' },
          { name: 'MLP-Mixers' },
          { name: 'State Space Models', tags: ['hot'] },
          { name: 'Diffusion Models', tags: ['hot'] }
        ]},
        { name: 'Scaling Laws', children: [
          { name: 'Chinchilla Optimal', tags: ['important'] },
          { name: 'Emergent Capabilities' },
          { name: 'Compute-Optimal Training' },
          { name: 'Data Mixing Laws' }
        ]},
        { name: 'Training Dynamics', children: [
          { name: 'Loss Landscapes' },
          { name: 'Gradient Flow' },
          { name: 'Batch Normalization Theory' },
          { name: 'Neural Tangent Kernel' }
        ]},
        { name: 'Alignment & RLHF', children: [
          { name: 'Reward Modeling' },
          { name: 'PPO for LLMs' },
          { name: 'Constitutional AI' },
          { name: 'DPO', tags: ['recent'] }
        ]}
      ]},

      { name: 'Geometric ML', icon: '◯', tags: ['frontier'], children: [
        { name: 'Hyperbolic Representations', content: 'Embeddings in hyperbolic space for hierarchical data.', children: [
          { name: 'Poincaré Embeddings', tags: ['core', 'umbra'], content: 'LIVE: This workspace uses Poincaré disk model. See hyperbolic-engine.js.', action: 'toggleVoronoi' },
          { name: 'Lorentz Model', tags: ['important', 'umbra'], content: 'LIVE: H^8 in R^9 used for high-dim operations. See lorentz-geometry.js.', action: 'toggleTransport' },
          { name: 'Hyperbolic Neural Networks' },
          { name: 'Hyperbolic Attention' }
        ]},
        { name: 'Geometric Algebra', children: [
          { name: 'Clifford Algebras' },
          { name: 'Conformal GA (CGA)', tags: ['important'] },
          { name: 'Projective GA (PGA)' },
          { name: 'GA for Graphics' }
        ]},
        { name: 'Field-Based Rendering', children: [
          { name: 'Neural Radiance Fields' },
          { name: 'Gaussian Splatting', tags: ['hot'] },
          { name: 'Implicit Surfaces' },
          { name: 'Kernel Methods on Manifolds' }
        ]},
        { name: 'Category Theory in ML', children: [
          { name: 'Functorial Learning' },
          { name: 'Polynomial Functors' },
          { name: 'Optics & Lenses' },
          { name: 'Categorical Gradient Descent' }
        ]}
      ]},

      { name: 'Umbra Foundations', icon: '🌀', tags: ['live', 'umbra'], content: 'Mathematical techniques actively used in this hyperbolic workspace.', children: [
        { name: 'Complex Arithmetic', content: 'LIVE: C(re,im), cmul, cdiv, cabs, carg. Foundation for Poincaré disk.', tags: ['core', 'umbra'], children: [
          { name: 'Möbius Transforms', tags: ['umbra'], content: 'LIVE: mobius(a,z) and mobiusInv(a,w) for isometric navigation.' },
          { name: 'Numerical Guards', tags: ['umbra'], content: 'LIVE: EPSILON, MAX_ATANH_ARG, clampDisk for boundary stability.' },
          { name: 'Complex Division', tags: ['umbra'], content: 'LIVE: Safe cdiv with zero-check prevents NaN propagation.' }
        ]},
        { name: 'Hyperbolic Geodesics', content: 'LIVE: Shortest paths in Poincaré disk are circular arcs ⊥ boundary.', tags: ['core', 'umbra'], children: [
          { name: 'Geodesic Lerp', tags: ['umbra'], content: 'LIVE: geodesicLerp uses tanh/atanh for proper interpolation.' },
          { name: 'Geodesic Arc', tags: ['umbra'], content: 'LIVE: Computes circle center outside disk for arc rendering.' },
          { name: 'Hyperbolic Distance', tags: ['umbra'], content: 'LIVE: hypDist = 2·arctanh(|z-w|/|1-z̄w|).' },
          { name: 'Hyperbolic Midpoint', tags: ['umbra'], content: 'LIVE: hypMidpoint via geodesic interpolation at t=0.5.' }
        ]},
        { name: 'Lorentz Geometry', content: 'LIVE: H^8 embedded in R^9 with Minkowski metric (-,+,+,...).', tags: ['core', 'umbra'], children: [
          { name: 'Minkowski Inner Product', tags: ['umbra'], content: 'LIVE: ⟨x,y⟩ = -x₀y₀ + x₁y₁ + ... + x₈y₈.' },
          { name: 'Exponential Map', tags: ['umbra'], content: 'LIVE: lorentzExp maps tangent vectors to hyperboloid.' },
          { name: 'Lorentz Boost', tags: ['umbra'], content: 'LIVE: Hyperbolic translations in high-dim space.' },
          { name: 'Poincaré ↔ Lorentz', tags: ['umbra'], content: 'LIVE: fromPoincareDisk/toPoincareDisk coordinate transforms.' }
        ]},
        { name: 'Spatial Indexing', content: 'LIVE: Efficient nearest-neighbor and range queries.', tags: ['core', 'umbra'], children: [
          { name: 'Ball Trees', tags: ['umbra'], content: 'LIVE: BallTree class in lorentz-geometry.js for O(log n) kNN.' },
          { name: 'Spatial Bucketing', tags: ['umbra'], content: 'LIVE: Grid-based bucketing for O(n·k) force layout.' },
          { name: 'Hit Test Cache', tags: ['umbra'], content: 'LIVE: Cached screen positions for 60fps hover detection.' }
        ]},
        { name: 'Geometric Overlays', content: 'LIVE: P1/P3 extension features for visualization.', tags: ['umbra'], children: [
          { name: 'Hyperbolic Voronoi', tags: ['umbra'], content: 'LIVE: Voronoi cells via Klein model projection.', action: 'toggleVoronoi' },
          { name: '{p,q} Tilings', tags: ['umbra'], content: 'LIVE: {7,3} tessellation using discrete subgroups.', action: 'toggleTiling' },
          { name: 'Parallel Transport', tags: ['umbra'], content: 'LIVE: Vector transport along geodesic paths.', action: 'toggleTransport' },
          { name: 'Hyperbolic Circles', tags: ['umbra'], content: 'LIVE: hypCircle using tanh(r/2) for Euclidean radius.' }
        ]},
        { name: 'Layout Algorithms', content: 'LIVE: Graph layout in hyperbolic space.', tags: ['umbra'], children: [
          { name: 'BFS Hyperbolic Layout', tags: ['umbra'], content: 'LIVE: layoutHyperbolic places children along geodesics from parent.' },
          { name: 'Force-Directed Relayout', tags: ['umbra'], content: 'LIVE: relayoutAroundPins with attraction to pinned nodes.' },
          { name: 'Subtree Relayout', tags: ['umbra'], content: 'LIVE: relayoutSubtree after reparenting operations.' }
        ]}
      ]},

      { name: 'Advanced Geometry', icon: '∞', tags: ['theory'], children: [
        { name: 'Lorentz / Hyperboloid', tags: ['fork-a', 'umbra'], content: 'Used in Umbra for high-dimensional operations.', children: [
          { name: 'Minkowski Inner Product', tags: ['umbra'], content: 'LIVE: Core of lorentz-geometry.js.' },
          { name: 'H^n in R^{n,1}', tags: ['umbra'], content: 'LIVE: We use H^8 in R^9 for embedding coordinates.' },
          { name: 'Fast Group Actions', content: 'Boosts and rotations via matrix operations.' },
          { name: 'Chart Projections', tags: ['umbra'], content: 'LIVE: Poincaré ball ↔ hyperboloid conversions.' }
        ]},
        { name: 'Field Sampling', tags: ['fork-b'], children: [
          { name: 'Radiance Fields' },
          { name: 'Kernel Sums' },
          { name: 'Wave Propagation' },
          { name: 'Ray Marching on GPU' }
        ]},
        { name: 'Conformal GA', tags: ['fork-c'], children: [
          { name: 'Points as Null Vectors' },
          { name: 'Spheres & Planes' },
          { name: 'Sandwich Products' },
          { name: 'Meet & Join Operations' }
        ]},
        { name: 'Efficiency Techniques', tags: ['umbra'], content: 'Used for performance in Umbra.', children: [
          { name: 'Barnes-Hut / FMM' },
          { name: 'Hyperbolic Ball Trees', tags: ['umbra'], content: 'LIVE: BallTree for nearest neighbor queries.' },
          { name: 'LOD & Culling', tags: ['umbra'], content: 'LIVE: computeLOD, isVisibleAtLOD in lorentz-geometry.js.' },
          { name: 'Sparse Evaluation', content: 'Only compute visible/relevant nodes.' }
        ]}
      ]}
    ]
  },

  langs: {
    name: 'Languages',
    color: '#c9a87c',
    icon: 'scroll',
    rootIcon: '𐤀',
    data: [
      { name: 'Semitic Languages', icon: '📜', tags: ['family'], children: [
        { name: 'Northwest Semitic', children: [
          { name: 'Hebrew', tags: ['core'], children: [
            { name: 'Biblical Hebrew', tags: ['classical'] },
            { name: 'Mishnaic Hebrew' },
            { name: 'Medieval Hebrew' },
            { name: 'Modern Hebrew', tags: ['living'] },
            { name: 'Dead Sea Scrolls', tags: ['corpus'] }
          ]},
          { name: 'Aramaic', tags: ['core'], children: [
            { name: 'Old Aramaic', tags: ['epigraphic'] },
            { name: 'Imperial Aramaic' },
            { name: 'Biblical Aramaic' },
            { name: 'Jewish Palestinian Aramaic' },
            { name: 'Syriac', tags: ['literary'] },
            { name: 'Mandaic' },
            { name: 'Neo-Aramaic', tags: ['living', 'endangered'] }
          ]},
          { name: 'Canaanite', children: [
            { name: 'Phoenician', tags: ['epigraphic'] },
            { name: 'Punic' },
            { name: 'Moabite', tags: ['attested'] },
            { name: 'Ammonite', tags: ['attested'] },
            { name: 'Edomite', tags: ['fragmentary'] }
          ]},
          { name: 'Ugaritic', tags: ['cuneiform', 'important'] }
        ]},
        { name: 'Arabic', tags: ['core'], children: [
          { name: 'Classical Arabic', tags: ['literary'] },
          { name: 'Quranic Arabic' },
          { name: 'Pre-Islamic Arabic', tags: ['epigraphic'] },
          { name: 'Modern Standard Arabic' },
          { name: 'Dialectal Varieties', children: [
            { name: 'Levantine Arabic', tags: ['living'] },
            { name: 'Egyptian Arabic' },
            { name: 'Gulf Arabic' },
            { name: 'Maghrebi Arabic' }
          ]}
        ]},
        { name: 'East Semitic', children: [
          { name: 'Akkadian', tags: ['cuneiform', 'important'], children: [
            { name: 'Old Akkadian' },
            { name: 'Old Babylonian', tags: ['literary'] },
            { name: 'Standard Babylonian' },
            { name: 'Neo-Assyrian' },
            { name: 'Neo-Babylonian' }
          ]},
          { name: 'Eblaite', tags: ['cuneiform'] }
        ]},
        { name: 'South Semitic', children: [
          { name: 'Ge\'ez', tags: ['classical', 'liturgical'] },
          { name: 'Amharic', tags: ['living'] },
          { name: 'Tigrinya', tags: ['living'] },
          { name: 'Old South Arabian', tags: ['epigraphic'] }
        ]}
      ]},

      { name: 'Scripts & Writing', icon: '✍', children: [
        { name: 'Proto-Scripts', children: [
          { name: 'Proto-Sinaitic', tags: ['origin'] },
          { name: 'Wadi el-Hol inscriptions' },
          { name: 'Proto-Canaanite' }
        ]},
        { name: 'Alphabets', children: [
          { name: 'Phoenician Alphabet', tags: ['ancestor', 'important'] },
          { name: 'Paleo-Hebrew' },
          { name: 'Hebrew Square Script' },
          { name: 'Aramaic Script' },
          { name: 'Arabic Script' },
          { name: 'Nabataean Script', tags: ['transitional'] },
          { name: 'Syriac Scripts', children: [
            { name: 'Estrangela' },
            { name: 'Serto' },
            { name: 'Eastern' }
          ]}
        ]},
        { name: 'Cuneiform', children: [
          { name: 'Sumerian Cuneiform', tags: ['origin'] },
          { name: 'Akkadian Adaptation' },
          { name: 'Ugaritic Alphabet', tags: ['hybrid'] },
          { name: 'Old Persian Cuneiform' }
        ]},
        { name: 'Greek Descendants', children: [
          { name: 'Greek Alphabet', tags: ['vowels'] },
          { name: 'Latin Alphabet' },
          { name: 'Cyrillic Alphabet' },
          { name: 'Coptic Alphabet' }
        ]}
      ]},

      { name: 'Corpora & Texts', icon: '📚', children: [
        { name: 'Bronze Age', children: [
          { name: 'Ugaritic Tablets', tags: ['mythological'] },
          { name: 'Tell el-Amarna Letters', tags: ['diplomatic'] },
          { name: 'Ebla Archives' },
          { name: 'Mari Archives' }
        ]},
        { name: 'Iron Age', children: [
          { name: 'Mesha Stele', tags: ['Moabite'] },
          { name: 'Siloam Inscription', tags: ['Hebrew'] },
          { name: 'Gezer Calendar' },
          { name: 'Lachish Letters', tags: ['ostraca'] },
          { name: 'Arad Ostraca' },
          { name: 'Deir Alla Inscription' }
        ]},
        { name: 'Classical', children: [
          { name: 'Dead Sea Scrolls', tags: ['important', 'corpus'] },
          { name: 'Septuagint' },
          { name: 'Targumim' },
          { name: 'Peshitta' },
          { name: 'Mishnah & Talmud' }
        ]},
        { name: 'Digital Corpora', children: [
          { name: 'CDLI (Cuneiform)', tags: ['database'] },
          { name: 'ETCSL (Sumerian)', tags: ['database'] },
          { name: 'CAL (Aramaic)', tags: ['database'] },
          { name: 'PPDB (Phoenician)', tags: ['database'] },
          { name: 'Tyndale House Corpus' }
        ]}
      ]},

      { name: 'Historical Linguistics', icon: '🔬', children: [
        { name: 'Sound Changes', children: [
          { name: 'Proto-Semitic Reconstruction' },
          { name: 'Canaanite Shift', tags: ['vowel'] },
          { name: 'Begadkefat Spirantization' },
          { name: 'Emphatic Consonants' },
          { name: 'Laryngeal Loss', tags: ['vowel'] }
        ]},
        { name: 'Grammaticalization', children: [
          { name: 'Article Development' },
          { name: 'Tense/Aspect Evolution' },
          { name: 'Case System Erosion' },
          { name: 'Verb System Changes' }
        ]},
        { name: 'Substrate & Contact', children: [
          { name: 'Sumerian-Akkadian Contact' },
          { name: 'Aramaic Loanwords', tags: ['widespread'] },
          { name: 'Greek Influence' },
          { name: 'Persian Loanwords' },
          { name: 'Arabic Substrate Effects' }
        ]},
        { name: 'Periodization', children: [
          { name: 'Attestation Timelines' },
          { name: 'Dialect Geography' },
          { name: 'Language Death & Revival' },
          { name: 'Diglossia Patterns' }
        ]}
      ]},

      { name: 'Genres & Literature', icon: '📖', children: [
        { name: 'Administrative', children: [
          { name: 'Royal Inscriptions' },
          { name: 'Economic Texts' },
          { name: 'Legal Documents' },
          { name: 'Letters & Correspondence' }
        ]},
        { name: 'Religious', children: [
          { name: 'Mythological Texts' },
          { name: 'Ritual Texts' },
          { name: 'Prophetic Literature' },
          { name: 'Wisdom Literature' },
          { name: 'Apocalyptic' }
        ]},
        { name: 'Poetic', children: [
          { name: 'Psalms & Hymns' },
          { name: 'Parallelism' },
          { name: 'Lament' },
          { name: 'Love Poetry' }
        ]},
        { name: 'Narrative', children: [
          { name: 'Historical Narrative' },
          { name: 'Epic' },
          { name: 'Court Tales' },
          { name: 'Origin Stories' }
        ]}
      ]},

      { name: 'Tools & Methods', icon: '🔧', children: [
        { name: 'Lexicography', children: [
          { name: 'HALOT', tags: ['Hebrew'] },
          { name: 'CAD', tags: ['Akkadian'] },
          { name: 'DNWSI', tags: ['NW Semitic'] },
          { name: 'Lane', tags: ['Arabic'] }
        ]},
        { name: 'Computational', children: [
          { name: 'Morphological Analyzers' },
          { name: 'Treebanks' },
          { name: 'OCR for Ancient Scripts' },
          { name: 'Machine Translation' }
        ]},
        { name: 'Epigraphy', children: [
          { name: 'Paleography' },
          { name: 'RTI Imaging' },
          { name: 'Decipherment Methods' },
          { name: '3D Scanning' }
        ]}
      ]},

      { name: 'Corpus Analytics', icon: '📊', tags: ['NLP', 'computational'], content: 'Statistical explorations for diachronic corpus analysis across decades to centuries.', children: [

        { name: 'I. Lexical Distribution', icon: '📈', content: 'Vocabulary structure and economy measures.', children: [
          { name: 'Zipf Exponent Drift', tags: ['core', 'api'], content: 'Fit Zipf\'s law per time slice; track exponent α. Reveals compression vs diversification.', action: 'openHyleEndpoint', data: { endpoint: '/api/hebrew/zipf' }},
          { name: 'Heaps Law Evolution', tags: ['core', 'api'], content: 'Vocabulary growth vs token count. Reveals productivity, stabilization vs innovation.', action: 'openHyleEndpoint', data: { endpoint: '/api/linguistics/heaps' }},
          { name: 'Type-Token Ratio (MTLD)', tags: ['api'], content: 'Moving-window MTLD/HD-D. Stylistic richness independent of document size.', action: 'openHyleEndpoint', data: { endpoint: '/api/hebrew/ttr' }},
          { name: 'Rare Word Mass', tags: ['api'], content: 'Proportion of hapax legomena. Edge creativity; neologism pressure.', action: 'openHyleEndpoint', data: { endpoint: '/api/linguistics/hapax' }}
        ]},

        { name: 'II. Temporal Dynamics', icon: '⏳', content: 'Word lifecycles and diachronic patterns.', children: [
          { name: 'Word Birth & Death', tags: ['survival'], content: 'First/last occurrence with survival analysis. Cultural turnover; lexical mortality curves.' },
          { name: 'Lexical Half-Life', tags: ['decay'], content: 'Time to 50% frequency decay post-peak. Trend vs infrastructure vocabulary.' },
          { name: 'Burstiness (Kleinberg)', tags: ['events', 'api'], content: 'Burst detection on token streams. Ideological waves, technological shocks.', action: 'openHyleEndpoint', data: { endpoint: '/api/linguistics/burstiness' }},
          { name: 'Term Seasonality', tags: ['periodic'], content: 'Spectral/Fourier analysis. Cyclic rituals, institutional calendars.' }
        ]},

        { name: 'III. Semantic Structure', icon: '🌐', content: 'Distributional semantics and meaning drift.', children: [
          { name: 'Embedding Drift', tags: ['core', 'shift'], content: 'Aligned embeddings; cosine displacement over time. Tracks meaning evolution.' },
          { name: 'Polysemy Dynamics', tags: ['senses'], content: 'Sense clustering variance over time. Conceptual specialization or generalization.' },
          { name: 'Neighborhood Volatility', tags: ['api'], content: 'Jaccard distance of k-NN sets across eras. Stability of conceptual neighborhoods.', action: 'openHyleEndpoint', data: { endpoint: '/api/linguistics/neighborhood' }},
          { name: 'Concept Density', tags: ['entropy'], content: 'Entropy of semantic clusters. Periods of ideological crystallization.' }
        ]},

        { name: 'IV. Syntax & Morphosyntax', icon: '🌳', content: 'Grammatical structure evolution.', children: [
          { name: 'Mean Dependency Length', tags: ['parse'], content: 'Parse trees; average dependency span. Cognitive load; prose formalization.' },
          { name: 'Clause Depth Distribution', tags: ['parse'], content: 'Parse tree depth histograms. Hypotaxis vs parataxis trends.' },
          { name: 'POS Entropy', tags: ['api'], content: 'Shannon entropy over POS sequences. Grammatical rigidity vs flexibility.', action: 'openHyleEndpoint', data: { endpoint: '/api/linguistics/pos-entropy' }},
          { name: 'Morphological Productivity', tags: ['affixes'], content: 'Affix productivity indices. Grammatical innovation rates.' }
        ]},

        { name: 'V. Information Theory', icon: '📡', content: 'Predictability and redundancy measures.', children: [
          { name: 'Perplexity Over Time', tags: ['core', 'lm'], content: 'Train n-gram/LM per era. Predictability of discourse across periods.' },
          { name: 'Surprisal Tails', tags: ['distribution'], content: 'Token-level surprisal statistics. Stylistic shock vs smoothness.' },
          { name: 'Compression Ratio', tags: ['api', 'redundancy'], content: 'LZ/PPM compression efficiency. Redundancy, formulaicity over time.', action: 'openHyleEndpoint', data: { endpoint: '/api/linguistics/compression' }}
        ]},

        { name: 'VI. Discourse & Pragmatics', icon: '💬', content: 'Text-level and pragmatic features.', children: [
          { name: 'Referential Distance', tags: ['anaphora'], content: 'Distance between anaphora and antecedents. Reader memory expectations.' },
          { name: 'Quotation Density', tags: ['intertextual'], content: 'Proportion of quoted speech/text. Authority structures; dialogicity.' },
          { name: 'Hedging & Modality', tags: ['epistemic'], content: 'Counts of epistemic markers. Epistemic humility vs assertiveness.' }
        ]},

        { name: 'VII. Network Topology', icon: '🕸️', content: 'Graph-theoretic views of language.', children: [
          { name: 'Co-occurrence Graph', tags: ['core', 'api'], content: 'Degree distribution, clustering coefficient. Core-periphery structure.', action: 'openHyleEndpoint', data: { endpoint: '/api/linguistics/cooccurrence-graph' }},
          { name: 'Percolation Thresholds', tags: ['connectivity'], content: 'Graph connectivity as frequency threshold varies. When discourse becomes "about something".' }
        ]},

        { name: 'Meta: Composability', icon: '🔗', content: 'Higher-order analytical compositions.', children: [
          { name: 'Diachronic Phase Diagrams', tags: ['synthesis'], content: 'Combine multiple measures into state-space visualizations.' },
          { name: 'Change-Point Detection', tags: ['events'], content: 'Identify structural breaks in linguistic timeseries.' },
          { name: 'Motif Persistence Lattices', tags: ['topology'], content: 'Track pattern persistence across scales.' },
          { name: 'Semantic Curvature', tags: ['geometry'], content: 'Embedding geodesics and manifold geometry.' },
          { name: 'Category-Theoretic View', tags: ['formal'], content: 'Functors over time; typed pipelines; EDN schemas.' }
        ]},

        { name: 'Hebrew Corpus', icon: '🔯', tags: ['active', 'api'], content: 'Live Hebrew corpus analysis endpoints.', children: [
          { name: 'Corpus Stats', tags: ['api', 'live'], content: 'Total documents, tokens, vocabulary size.', action: 'openHyleEndpoint', data: { endpoint: '/api/hebrew/stats' }},
          { name: 'Frequency Analysis', tags: ['api', 'live'], content: 'Word frequency distributions.', action: 'openHyleEndpoint', data: { endpoint: '/api/hebrew/freq' }},
          { name: 'TTR Analysis', tags: ['api', 'live'], content: 'Type-token ratio curves.', action: 'openHyleEndpoint', data: { endpoint: '/api/hebrew/ttr' }},
          { name: 'Zipf Plot', tags: ['api', 'live'], content: 'Zipf law fit visualization.', action: 'openHyleEndpoint', data: { endpoint: '/api/hebrew/zipf' }},
          { name: 'Text Browser', tags: ['api', 'live'], content: 'Browse individual texts in corpus.', action: 'openHyleEndpoint', data: { endpoint: '/api/hebrew/texts' }}
        ]}
      ]}
    ]
  },

  ux: {
    name: 'Interface',
    color: '#7ee787',
    icon: 'cursor',
    rootIcon: '🎯',
    data: [
      { name: 'Navigation', icon: '🧭', tags: ['core'], children: [
        { name: 'Focus Node', tags: ['action'], action: 'focusSelected', children: [
          { name: 'Click node', tags: ['gesture'] },
          { name: 'Arrow keys', tags: ['keyboard'] },
          { name: 'vim: hjkl', tags: ['keyboard'] },
          { name: 'Search (⌘K)', tags: ['keyboard', 'action'], action: 'openSearch' }
        ]},
        { name: 'Pan View', tags: ['action'], children: [
          { name: 'Drag canvas', tags: ['gesture'] },
          { name: 'Minimap drag', tags: ['gesture'] },
          { name: 'Momentum scroll', tags: ['physics'] }
        ]},
        { name: 'Zoom', tags: ['action'], children: [
          { name: 'Scroll wheel', tags: ['gesture'] },
          { name: '+/- keys', tags: ['keyboard'] },
          { name: 'Double-click zoom', tags: ['gesture'] },
          { name: 'Semantic zoom', tags: ['auto'] }
        ]},
        { name: 'History', tags: ['action'], children: [
          { name: 'Go back (⌘[)', tags: ['keyboard'] },
          { name: 'Go forward (⌘])', tags: ['keyboard'] },
          { name: 'Go home (H)', tags: ['keyboard'], action: 'goHome' }
        ]}
      ]},

      { name: 'Selection', icon: '✓', tags: ['core'], children: [
        { name: 'Single Select', tags: ['action'], children: [
          { name: 'Click node', tags: ['gesture'] },
          { name: 'Focus follows', tags: ['auto'] }
        ]},
        { name: 'Multi-Select', tags: ['action'], children: [
          { name: 'Ctrl/⌘+click', tags: ['gesture'] },
          { name: 'Select mode (s)', tags: ['keyboard'] },
          { name: 'Select children', tags: ['context-menu'] },
          { name: 'Select ancestors', tags: ['context-menu'] }
        ]},
        { name: 'Pin Node', tags: ['action'], children: [
          { name: 'Shift+click', tags: ['gesture'] },
          { name: 'P key', tags: ['keyboard'] },
          { name: 'Pins as anchors', tags: ['layout'] }
        ]}
      ]},

      { name: 'Path Tracing', icon: '📍', tags: ['measurement'], children: [
        { name: 'Path Mode (m)', tags: ['keyboard', 'action'], action: 'setPathMode', children: [
          { name: 'Click sequence', tags: ['gesture'] },
          { name: 'Alt+click add', tags: ['gesture'] },
          { name: 'Click to remove', tags: ['gesture'] }
        ]},
        { name: 'Path Metrics', children: [
          { name: 'Geodesic distance', tags: ['metric'] },
          { name: 'Hop count', tags: ['metric'] },
          { name: 'Path animation', tags: ['visualization'] }
        ]},
        { name: 'Parallel Transport', tags: ['geometry'], action: 'enableTransport', children: [
          { name: 'Vector field', tags: ['visualization'] },
          { name: 'Holonomy', tags: ['curvature'] }
        ]}
      ]},

      { name: 'Node Editing', icon: '✏️', tags: ['creation'], children: [
        { name: 'Create Node', tags: ['action'], action: 'createNodePrompt', children: [
          { name: 'Double-click empty', tags: ['gesture'] },
          { name: 'Links to focus', tags: ['auto'] }
        ]},
        { name: 'Delete Node', tags: ['action', 'destructive'], children: [
          { name: 'Context menu', tags: ['context-menu'] },
          { name: 'Deletes subtree', tags: ['warning'] }
        ]},
        { name: 'Link Nodes', tags: ['action'], children: [
          { name: 'Drag node to node', tags: ['gesture'] },
          { name: 'Creates edge', tags: ['graph'] }
        ]},
        { name: 'Reparent', tags: ['action'], children: [
          { name: 'Move in hierarchy', tags: ['structure'] },
          { name: 'Updates depth', tags: ['auto'] }
        ]}
      ]},

      { name: 'Folding', icon: '📦', tags: ['compression'], children: [
        { name: 'Fold (f)', tags: ['keyboard', 'action'], action: 'foldSelected', children: [
          { name: 'Compresses work', tags: ['concept'] },
          { name: 'Names the fold', tags: ['prompt'] },
          { name: 'Preserves structure', tags: ['internal'] }
        ]},
        { name: 'Unfold (u/f)', tags: ['keyboard', 'action'], children: [
          { name: 'Restores nodes', tags: ['restoration'] },
          { name: 'Position relative', tags: ['geometry'] }
        ]},
        { name: 'Witness Cut (⇧W)', tags: ['keyboard', 'action', 'ethics'], action: 'witnessCut', children: [
          { name: 'Acknowledges work', tags: ['accountability'] },
          { name: 'Records context', tags: ['persistence'] },
          { name: 'Releases state', tags: ['release'] }
        ]}
      ]},

      { name: 'Visualization', icon: '👁', tags: ['display'], children: [
        { name: 'Overlays', children: [
          { name: 'Voronoi cells', tags: ['toggle'], action: 'toggleVoronoi', content: 'Show hyperbolic Voronoi diagram of nodes.' },
          { name: 'Hyperbolic tiling', tags: ['toggle'], action: 'toggleTiling', content: 'Show {p,q} regular tiling pattern.' },
          { name: 'Transport vectors', tags: ['toggle'], action: 'toggleTransport', content: 'Show parallel transport along path.' },
          { name: 'Hypercycles', tags: ['toggle'], action: 'toggleHypercycles', content: 'Curves equidistant from geodesic edges.' },
          { name: 'Horocycles', tags: ['toggle'], action: 'toggleHorocycles', content: 'Circles tangent to boundary at infinity.' },
          { name: 'Ideal points', tags: ['toggle'], action: 'toggleIdealPoints', content: 'Where geodesics meet the boundary.' },
          { name: 'Circumcircles', tags: ['toggle'], action: 'toggleCircumcircles', content: 'Circles through triangle vertices.' },
          { name: 'Grid lines', tags: ['toggle'], action: 'toggleGrid' }
        ]},
        { name: 'Labels & Colors', children: [
          { name: 'Depth coloring', tags: ['toggle'] },
          { name: 'Node labels', tags: ['toggle'] },
          { name: 'Geodesic edges', tags: ['toggle'] }
        ]},
        { name: 'Focus Mode (⇧F)', tags: ['presentation'], action: 'toggleFocusMode', children: [
          { name: 'Hides UI', tags: ['clean'] },
          { name: 'Full canvas', tags: ['immersive'] }
        ]}
      ]},

      { name: 'Spaces', icon: '🌐', tags: ['domains'], children: [
        { name: 'Studies (1)', tags: ['keyboard'], action: 'switchStudies' },
        { name: 'Infrastructure (2)', tags: ['keyboard'], action: 'switchInfra' },
        { name: 'GitHub (3)', tags: ['keyboard'], action: 'switchGithub' },
        { name: 'Notes (4)', tags: ['keyboard'], action: 'switchNotes' },
        { name: 'Math (5)', tags: ['keyboard'], action: 'switchMath' },
        { name: 'Languages (6)', tags: ['keyboard'], action: 'switchLangs' },
        { name: 'Interface (7)', tags: ['keyboard'], action: 'switchUX' }
      ]}
    ]
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EMBEDDINGS - Vector embedding demonstrations
  // ═══════════════════════════════════════════════════════════════════════════
  embeddings: {
    name: 'Embeddings',
    color: '#ffd700',
    icon: 'network',
    rootIcon: '🧬',
    data: [
      // ─────────────────────────────────────────────────────────────────────────
      // WORD EMBEDDINGS - Semantic word relationships
      // ─────────────────────────────────────────────────────────────────────────
      { name: 'Word Vectors', icon: '📝', tags: ['nlp', 'embedding'], content: 'Word2Vec-style semantic embeddings. Similar words cluster together.', children: [
        { name: 'Royalty Analogy', tags: ['demo', 'classic'], content: 'King - Man + Woman ≈ Queen. The classic word analogy test.', children: [
          { name: 'king', tags: ['noun', 'royalty'], content: 'Male monarch. High in hierarchy.' },
          { name: 'queen', tags: ['noun', 'royalty'], content: 'Female monarch. Parallel to king.' },
          { name: 'man', tags: ['noun', 'gender'], content: 'Adult male human.' },
          { name: 'woman', tags: ['noun', 'gender'], content: 'Adult female human.' },
          { name: 'prince', tags: ['noun', 'royalty'], content: 'Male royal heir.' },
          { name: 'princess', tags: ['noun', 'royalty'], content: 'Female royal heir.' }
        ]},
        { name: 'Animals', tags: ['demo', 'taxonomy'], content: 'Animal kingdom hierarchy. Natural fit for hyperbolic space!', children: [
          { name: 'Mammals', children: [
            { name: 'dog', tags: ['domestic'], children: [
              { name: 'labrador' }, { name: 'poodle' }, { name: 'beagle' }, { name: 'bulldog' }
            ]},
            { name: 'cat', tags: ['domestic'], children: [
              { name: 'persian' }, { name: 'siamese' }, { name: 'maine coon' }
            ]},
            { name: 'horse', children: [{ name: 'stallion' }, { name: 'mare' }, { name: 'foal' }]},
            { name: 'whale', children: [{ name: 'blue whale' }, { name: 'orca' }, { name: 'humpback' }]}
          ]},
          { name: 'Birds', children: [
            { name: 'eagle', children: [{ name: 'bald eagle' }, { name: 'golden eagle' }]},
            { name: 'penguin', children: [{ name: 'emperor' }, { name: 'king penguin' }]},
            { name: 'sparrow' }, { name: 'crow' }, { name: 'owl' }
          ]},
          { name: 'Reptiles', children: [
            { name: 'snake', children: [{ name: 'cobra' }, { name: 'python' }, { name: 'viper' }]},
            { name: 'lizard', children: [{ name: 'gecko' }, { name: 'iguana' }, { name: 'chameleon' }]},
            { name: 'turtle' }, { name: 'crocodile' }
          ]}
        ]},
        { name: 'Capitals', tags: ['demo', 'geography'], content: 'Country-capital relationships. Paris is to France as Berlin is to Germany.', children: [
          { name: 'Europe', children: [
            { name: 'France → Paris' }, { name: 'Germany → Berlin' }, { name: 'Italy → Rome' },
            { name: 'Spain → Madrid' }, { name: 'UK → London' }, { name: 'Poland → Warsaw' }
          ]},
          { name: 'Asia', children: [
            { name: 'Japan → Tokyo' }, { name: 'China → Beijing' }, { name: 'India → Delhi' },
            { name: 'Korea → Seoul' }, { name: 'Thailand → Bangkok' }
          ]},
          { name: 'Americas', children: [
            { name: 'USA → Washington' }, { name: 'Canada → Ottawa' }, { name: 'Brazil → Brasília' },
            { name: 'Mexico → Mexico City' }, { name: 'Argentina → Buenos Aires' }
          ]}
        ]}
      ]},

      // ─────────────────────────────────────────────────────────────────────────
      // KNOWLEDGE GRAPH - Entity relationships
      // ─────────────────────────────────────────────────────────────────────────
      { name: 'Knowledge Graph', icon: '🕸️', tags: ['kg', 'entities'], content: 'Entity-relationship networks. Shows how knowledge connects.', children: [
        { name: 'Physics Concepts', tags: ['science'], children: [
          { name: 'Energy', tags: ['fundamental'], children: [
            { name: 'Kinetic Energy', children: [{ name: 'velocity' }, { name: 'mass' }] },
            { name: 'Potential Energy', children: [{ name: 'gravitational' }, { name: 'elastic' }, { name: 'chemical' }] },
            { name: 'Thermal Energy', children: [{ name: 'temperature' }, { name: 'heat' }] },
            { name: 'E=mc²', tags: ['famous'], children: [{ name: 'mass-energy' }, { name: 'relativity' }] }
          ]},
          { name: 'Forces', tags: ['fundamental'], children: [
            { name: 'Gravity', children: [{ name: 'Newton' }, { name: 'Einstein' }, { name: 'graviton' }] },
            { name: 'Electromagnetism', children: [{ name: 'electric' }, { name: 'magnetic' }, { name: 'photon' }] },
            { name: 'Strong Force', children: [{ name: 'quarks' }, { name: 'gluons' }] },
            { name: 'Weak Force', children: [{ name: 'W boson' }, { name: 'Z boson' }, { name: 'beta decay' }] }
          ]},
          { name: 'Particles', tags: ['quantum'], children: [
            { name: 'Fermions', children: [{ name: 'electron' }, { name: 'quark' }, { name: 'neutrino' }] },
            { name: 'Bosons', children: [{ name: 'photon' }, { name: 'gluon' }, { name: 'Higgs' }] }
          ]}
        ]},
        { name: 'Historical Figures', tags: ['history'], children: [
          { name: 'Scientists', children: [
            { name: 'Newton', tags: ['physics'], children: [{ name: 'calculus' }, { name: 'gravity' }, { name: 'optics' }] },
            { name: 'Einstein', tags: ['physics'], children: [{ name: 'relativity' }, { name: 'photoelectric' }, { name: 'E=mc²' }] },
            { name: 'Darwin', tags: ['biology'], children: [{ name: 'evolution' }, { name: 'natural selection' }, { name: 'Beagle' }] },
            { name: 'Curie', tags: ['chemistry'], children: [{ name: 'radioactivity' }, { name: 'polonium' }, { name: 'radium' }] }
          ]},
          { name: 'Philosophers', children: [
            { name: 'Plato', children: [{ name: 'Forms' }, { name: 'Republic' }, { name: 'Allegory of Cave' }] },
            { name: 'Aristotle', children: [{ name: 'logic' }, { name: 'ethics' }, { name: 'politics' }] },
            { name: 'Kant', children: [{ name: 'categorical imperative' }, { name: 'critique' }, { name: 'transcendental' }] }
          ]}
        ]}
      ]},

      // ─────────────────────────────────────────────────────────────────────────
      // NEURAL NETWORK - Architecture visualization
      // ─────────────────────────────────────────────────────────────────────────
      { name: 'Neural Architectures', icon: '🧠', tags: ['ml', 'architecture'], content: 'Neural network layer hierarchies. Model architectures as trees.', children: [
        { name: 'Transformer', tags: ['attention', 'hot'], content: 'Self-attention architecture. Powers GPT, BERT, etc.', children: [
          { name: 'Encoder', children: [
            { name: 'Self-Attention', children: [
              { name: 'Q projection' }, { name: 'K projection' }, { name: 'V projection' },
              { name: 'Attention scores' }, { name: 'Softmax' }, { name: 'Output projection' }
            ]},
            { name: 'FFN', children: [
              { name: 'Linear 1 (expand)' }, { name: 'GELU' }, { name: 'Linear 2 (contract)' }
            ]},
            { name: 'LayerNorm' }, { name: 'Residual' }
          ]},
          { name: 'Decoder', children: [
            { name: 'Masked Self-Attention' },
            { name: 'Cross-Attention', children: [{ name: 'encoder K' }, { name: 'encoder V' }] },
            { name: 'FFN' }, { name: 'LayerNorm' }
          ]},
          { name: 'Embeddings', children: [
            { name: 'Token Embedding' }, { name: 'Position Embedding' }, { name: 'Segment Embedding' }
          ]}
        ]},
        { name: 'ResNet', tags: ['cnn', 'classic'], content: 'Residual network. Skip connections enable very deep networks.', children: [
          { name: 'Stem', children: [{ name: 'Conv 7x7' }, { name: 'BatchNorm' }, { name: 'ReLU' }, { name: 'MaxPool' }] },
          { name: 'Stage 1', children: [{ name: 'Block 1' }, { name: 'Block 2' }, { name: 'Block 3' }] },
          { name: 'Stage 2', children: [{ name: 'Block 1 (stride 2)' }, { name: 'Block 2' }, { name: 'Block 3' }, { name: 'Block 4' }] },
          { name: 'Stage 3', children: [{ name: 'Block 1' }, { name: 'Block 2' }, { name: 'Block 3' }, { name: 'Block 4' }, { name: 'Block 5' }, { name: 'Block 6' }] },
          { name: 'Stage 4', children: [{ name: 'Block 1' }, { name: 'Block 2' }, { name: 'Block 3' }] },
          { name: 'Head', children: [{ name: 'GlobalAvgPool' }, { name: 'FC 1000' }, { name: 'Softmax' }] }
        ]},
        { name: 'U-Net', tags: ['segmentation'], content: 'Encoder-decoder with skip connections for image segmentation.', children: [
          { name: 'Encoder', children: [
            { name: 'Conv Block 1', children: [{ name: '64 channels' }] },
            { name: 'Conv Block 2', children: [{ name: '128 channels' }] },
            { name: 'Conv Block 3', children: [{ name: '256 channels' }] },
            { name: 'Conv Block 4', children: [{ name: '512 channels' }] }
          ]},
          { name: 'Bottleneck', children: [{ name: '1024 channels' }] },
          { name: 'Decoder', children: [
            { name: 'Up Block 1', children: [{ name: 'Upsample' }, { name: 'Skip concat' }, { name: 'Conv' }] },
            { name: 'Up Block 2' }, { name: 'Up Block 3' }, { name: 'Up Block 4' }
          ]},
          { name: 'Output', children: [{ name: '1x1 Conv' }, { name: 'Sigmoid' }] }
        ]}
      ]},

      // ─────────────────────────────────────────────────────────────────────────
      // CODE DEPENDENCIES - Software module graph
      // ─────────────────────────────────────────────────────────────────────────
      { name: 'Code Dependencies', icon: '📦', tags: ['software', 'deps'], content: 'Software module dependency graphs. Imports and exports.', children: [
        { name: 'React Ecosystem', tags: ['frontend'], children: [
          { name: 'react', tags: ['core'], children: [
            { name: 'react-dom', children: [{ name: 'createRoot' }, { name: 'hydrate' }] },
            { name: 'react-native', children: [{ name: 'View' }, { name: 'Text' }, { name: 'TouchableOpacity' }] },
            { name: 'hooks', children: [{ name: 'useState' }, { name: 'useEffect' }, { name: 'useContext' }, { name: 'useReducer' }, { name: 'useMemo' }, { name: 'useCallback' }] }
          ]},
          { name: 'State Management', children: [
            { name: 'redux', children: [{ name: 'createStore' }, { name: 'combineReducers' }, { name: 'applyMiddleware' }] },
            { name: 'zustand', children: [{ name: 'create' }, { name: 'devtools' }, { name: 'persist' }] },
            { name: 'jotai', children: [{ name: 'atom' }, { name: 'useAtom' }] }
          ]},
          { name: 'Routing', children: [
            { name: 'react-router', children: [{ name: 'BrowserRouter' }, { name: 'Route' }, { name: 'Link' }, { name: 'useNavigate' }] },
            { name: 'next/router', children: [{ name: 'useRouter' }, { name: 'push' }, { name: 'replace' }] }
          ]}
        ]},
        { name: 'Python ML Stack', tags: ['backend', 'ml'], children: [
          { name: 'numpy', tags: ['core'], children: [{ name: 'ndarray' }, { name: 'linalg' }, { name: 'fft' }, { name: 'random' }] },
          { name: 'pytorch', children: [
            { name: 'nn', children: [{ name: 'Module' }, { name: 'Linear' }, { name: 'Conv2d' }, { name: 'Transformer' }] },
            { name: 'optim', children: [{ name: 'Adam' }, { name: 'SGD' }, { name: 'lr_scheduler' }] },
            { name: 'autograd', children: [{ name: 'backward' }, { name: 'grad' }] }
          ]},
          { name: 'transformers', children: [
            { name: 'AutoModel' }, { name: 'AutoTokenizer' }, { name: 'Trainer' }, { name: 'pipeline' }
          ]}
        ]}
      ]},

      // ─────────────────────────────────────────────────────────────────────────
      // POINCARÉ EMBEDDINGS - Real hierarchical data
      // ─────────────────────────────────────────────────────────────────────────
      { name: 'Poincaré Embeddings', icon: '🔵', tags: ['research', 'hyperbolic'], content: 'True hyperbolic embeddings. Hierarchies with minimal distortion.', children: [
        { name: 'WordNet Nouns', tags: ['nlp', 'taxonomy'], content: 'WordNet noun hierarchy. 80k+ concepts in hyperbolic space.', children: [
          { name: 'entity.n.01', tags: ['root'], children: [
            { name: 'physical_entity.n.01', children: [
              { name: 'object.n.01', children: [
                { name: 'whole.n.02', children: [{ name: 'artifact.n.01' }, { name: 'living_thing.n.01' }] },
                { name: 'part.n.01' }
              ]},
              { name: 'substance.n.01' }, { name: 'thing.n.12' }
            ]},
            { name: 'abstract_entity.n.01', children: [
              { name: 'abstraction.n.06', children: [{ name: 'attribute.n.02' }, { name: 'relation.n.01' }] },
              { name: 'group.n.01' }, { name: 'measure.n.02' }
            ]}
          ]}
        ]},
        { name: 'Organizational Hierarchy', tags: ['business'], content: 'Company org chart. Classic tree structure.', children: [
          { name: 'CEO', tags: ['executive'], children: [
            { name: 'CTO', children: [
              { name: 'VP Engineering', children: [
                { name: 'Director Frontend', children: [{ name: 'Team Lead 1' }, { name: 'Team Lead 2' }] },
                { name: 'Director Backend', children: [{ name: 'Team Lead 3' }, { name: 'Team Lead 4' }] },
                { name: 'Director Infra', children: [{ name: 'SRE Lead' }, { name: 'DevOps Lead' }] }
              ]},
              { name: 'VP Product', children: [
                { name: 'PM Lead' }, { name: 'Design Lead' }, { name: 'Research Lead' }
              ]}
            ]},
            { name: 'CFO', children: [
              { name: 'Controller' }, { name: 'Treasury' }, { name: 'FP&A' }
            ]},
            { name: 'COO', children: [
              { name: 'HR Director' }, { name: 'Legal Director' }, { name: 'Ops Director' }
            ]}
          ]}
        ]},
        { name: 'File System', tags: ['filesystem'], content: 'Directory tree structure. Deeply nested paths.', children: [
          { name: '/', children: [
            { name: 'home', children: [
              { name: 'user', children: [
                { name: 'Documents', children: [{ name: 'work' }, { name: 'personal' }] },
                { name: 'Downloads' },
                { name: 'Projects', children: [
                  { name: 'app', children: [{ name: 'src' }, { name: 'tests' }, { name: 'docs' }] },
                  { name: 'lib' }, { name: 'scripts' }
                ]}
              ]}
            ]},
            { name: 'etc', children: [{ name: 'nginx' }, { name: 'ssh' }, { name: 'hosts' }] },
            { name: 'var', children: [{ name: 'log' }, { name: 'www' }, { name: 'lib' }] },
            { name: 'usr', children: [{ name: 'bin' }, { name: 'lib' }, { name: 'local' }] }
          ]}
        ]}
      ]}
    ]
  }
};

// ════════════════════════════════════════════════════════════════════════════
// NODE ACTIONS REGISTRY
// ════════════════════════════════════════════════════════════════════════════

// Default Hyle API base URL (configurable)
let HYLE_BASE_URL = 'http://localhost:8769';

const nodeActions = {
  // Navigation
  focusSelected: () => { /* already focused */ },
  openSearch: () => openCommandPalette(),
  goHome: () => goHome(),

  // Modes
  setPathMode: () => setMode('path'),
  enableTransport: () => { state.settings.overlays.transport = true; scheduleAutoSave(); },

  // Visualization toggles (with auto-save)
  toggleVoronoi: () => { state.settings.overlays.voronoi = !state.settings.overlays.voronoi; scheduleAutoSave(); },
  toggleTiling: () => { state.settings.overlays.tiling = !state.settings.overlays.tiling; scheduleAutoSave(); },
  toggleTransport: () => { state.settings.overlays.transport = !state.settings.overlays.transport; scheduleAutoSave(); },
  toggleHypercycles: () => { state.settings.overlays.hypercycles = !state.settings.overlays.hypercycles; scheduleAutoSave(); },
  toggleHorocycles: () => { state.settings.overlays.horocycles = !state.settings.overlays.horocycles; scheduleAutoSave(); },
  toggleIdealPoints: () => { state.settings.overlays.idealPoints = !state.settings.overlays.idealPoints; scheduleAutoSave(); },
  toggleCircumcircles: () => { state.settings.overlays.circumcircles = !state.settings.overlays.circumcircles; scheduleAutoSave(); },
  toggleGrid: () => { state.settings.features.grid = !state.settings.features.grid; scheduleAutoSave(); },
  toggleFocusMode: () => toggleFocusMode(),

  // Space switching
  switchHyperbolic: () => switchSpace('hyperbolic'),
  switchStudies: () => switchSpace('hyperbolic'),
  switchInfra: () => switchSpace('infra'),
  switchGithub: () => switchSpace('github'),
  switchNotes: () => switchSpace('notes'),
  switchMath: () => switchSpace('math'),
  switchLangs: () => switchSpace('langs'),
  switchUX: () => switchSpace('ux'),
  switchEmbeddings: () => switchSpace('embeddings'),

  // Node operations
  foldSelected: () => {
    const graph = currentGraph();
    const nodesToFold = [...state.selected];
    if (nodesToFold.length > 0) {
      const name = prompt('Name this fold:', `Fold ${foldIdCounter + 1}`);
      if (name !== null) {
        fold(graph, nodesToFold, name);
      }
    }
  },
  witnessCut: () => witnessAndRelease(),
  createNodePrompt: () => {
    const name = prompt('Node name:', 'New Node');
    if (name) {
      createNode({ name, parent: state.focus });
    }
  },

  // Hyle API integration
  openHyleEndpoint: (node, graph) => {
    if (!node.data || !node.data.endpoint) {
      showToast('No endpoint configured');
      return;
    }
    const url = HYLE_BASE_URL + node.data.endpoint;
    fetchAndShowData(node.name, url);
  },

  // Infrastructure live inspection actions
  openPrometheusMetrics: (node) => {
    fetchAndShowData('Prometheus Metrics', 'http://localhost:9090/api/v1/targets');
  },
  openGrafanaDashboard: (node) => {
    window.open('http://localhost:3000', '_blank');
    showToast('Opening Grafana dashboard...');
  },
  checkServiceHealth: async (node) => {
    const serviceName = node.name;
    showToast(`Checking ${serviceName}...`);
    // Simulate health check
    setTimeout(() => {
      const status = node.tags?.includes('healthy') ? '✅ healthy' : '⚠️ degraded';
      showToast(`${serviceName}: ${status}`);
    }, 500);
  },
  openJenkinsJob: (node) => {
    window.open('http://localhost:8080', '_blank');
    showToast('Opening Jenkins...');
  },
  openArgoCD: (node) => {
    window.open('http://localhost:8081', '_blank');
    showToast('Opening ArgoCD...');
  },

  // Vespers Playgrounds
  openPlayground: (node, graph) => {
    if (!node.data) {
      showToast('No playground data');
      return;
    }
    // Prefer remote URL if available, fall back to local
    const url = node.data.url || node.data.local;
    if (url) {
      window.open(url, '_blank');
      showToast(`Opening ${node.name}...`);
    } else {
      showToast('No URL configured for playground');
    }
  },

  // Documentation viewing
  openDocumentation: (node, graph) => {
    if (!node.data || !node.data.file) {
      showToast('No documentation file configured');
      return;
    }
    // Could open in modal or new tab
    showToast(`Documentation: ${node.data.file}`);
  },
  showDatabaseStats: async (node) => {
    showToast(`Database: ${node.name}`);
    // Could connect to real metrics endpoint
    const mockStats = {
      connections: Math.floor(Math.random() * 100) + 20,
      queries_per_sec: Math.floor(Math.random() * 500) + 100,
      replication_lag: node.tags?.includes('replica') ? '1.2s' : 'n/a'
    };
    setTimeout(() => {
      showToast(`Connections: ${mockStats.connections}, QPS: ${mockStats.queries_per_sec}`);
    }, 300);
  },
  showCacheStats: async (node) => {
    showToast(`Cache: ${node.name}`);
    const mockStats = {
      hits: Math.floor(Math.random() * 10000) + 5000,
      misses: Math.floor(Math.random() * 500) + 100,
      memory: '12.4GB / 16GB'
    };
    setTimeout(() => {
      showToast(`Hit rate: ${(mockStats.hits / (mockStats.hits + mockStats.misses) * 100).toFixed(1)}%`);
    }, 300);
  },
  showLoadBalancerStats: async (node) => {
    showToast(`LB: ${node.name}`);
    const mockStats = {
      active_connections: Math.floor(Math.random() * 1000) + 200,
      requests_per_sec: Math.floor(Math.random() * 5000) + 1000,
      upstream_health: node.tags?.includes('healthy') ? 'all green' : '1 degraded'
    };
    setTimeout(() => {
      showToast(`RPS: ${mockStats.requests_per_sec}, Upstreams: ${mockStats.upstream_health}`);
    }, 300);
  }
};

// Fetch data from URL and display in modal/toast
async function fetchAndShowData(title, url) {
  showToast(`Fetching ${title}...`);
  try {
    const response = await fetch(url, { timeout: 5000 });
    if (response.ok) {
      const data = await response.json();
      // For now, show summary in toast. Could open modal.
      const summary = JSON.stringify(data).slice(0, 100) + '...';
      showToast(`${title}: ${summary}`);
      console.log(`${title}:`, data);
    } else {
      showToast(`${title}: HTTP ${response.status}`);
    }
  } catch (e) {
    showToast(`${title}: ${e.message}`);
    console.error(`Failed to fetch ${url}:`, e);
  }
}

// Resolve action string to function
function resolveAction(actionName) {
  if (typeof actionName === 'function') return actionName;
  if (typeof actionName === 'string' && nodeActions[actionName]) {
    return nodeActions[actionName];
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// GRAPH BUILDER
// ════════════════════════════════════════════════════════════════════════════

function buildGraph(spaceKey) {
  const space = SPACES[spaceKey];
  const nodes = new Map();
  const edges = [];
  let id = 0;

  const typeMap = {
    0: 'root',
    1: 'category',
    2: 'topic',
    3: 'item',
    4: 'leaf'
  };

  const iconMap = {
    root: space.rootIcon,
    category: '📁',
    topic: '📄',
    item: '•',
    leaf: '·'
  };

  function addNode(name, depth, parentId, extra = {}) {
    const type = typeMap[Math.min(depth, 4)];
    const node = {
      id,
      name,
      depth,
      parent: parentId,
      children: [],
      type,
      icon: extra.icon || iconMap[type],
      tags: extra.tags || [],
      pinned: false,
      hidden: false,
      collapsed: false,
      z: null,
      action: extra.action ? resolveAction(extra.action) : null,
      data: extra.data || {}
    };
    nodes.set(id, node);
    if (parentId !== null) {
      edges.push([parentId, id]);
      nodes.get(parentId).children.push(id);
    }
    return id++;
  }

  function traverse(items, parentId, depth) {
    items.forEach((item) => {
      const name = typeof item === 'string' ? item : item.name;
      const nodeId = addNode(name, depth, parentId, typeof item === 'object' ? item : {});
      if (typeof item === 'object' && item.children) {
        traverse(item.children, nodeId, depth + 1);
      }
    });
  }

  // Build tree
  addNode(space.name, 0, null, { icon: space.rootIcon });
  traverse(space.data, 0, 1);

  // Layout using hyperbolic placement
  layoutHyperbolic(nodes);

  const maxDepth = Math.max(...[...nodes.values()].map(n => n.depth));

  return { nodes, edges, maxDepth };
}

/**
 * Layout a graph in hyperbolic space using breadth-first placement.
 *
 * Algorithm:
 * 1. Place root at origin
 * 2. For each node, place children along geodesics radiating outward
 * 3. Use Möbius transformation to respect hyperbolic metric
 *
 * The hyperbolic plane has exponentially more area at greater distances,
 * making it ideal for hierarchical data where each level can have
 * many more nodes than the previous.
 */
function layoutHyperbolic(nodes) {
  if (!nodes || nodes.size === 0) return;

  const root = nodes.get(0);
  if (!root) return;

  root.z = C(0, 0);

  const queue = [0];
  const visited = new Set([0]);
  let iterations = 0;

  while (queue.length && iterations < MAX_ITERATIONS) {
    iterations++;
    const pid = queue.shift();
    const parent = nodes.get(pid);

    if (!parent || !parent.children || parent.children.length === 0) continue;

    const children = parent.children;

    // Compute hyperbolic distance to place children at
    // In hyperbolic space, we have exponentially more room at each level
    // Use depth-adaptive radius: deeper nodes are placed farther (hyperbolically)
    const depth = parent.depth || 0;
    const hypRadius = 0.4 + depth * 0.15; // Hyperbolic radius from parent
    const eucRadius = Math.tanh(clampNumber(hypRadius / 2, 0, 5));  // Convert to Poincaré disk

    // Angle distribution around parent
    // For root (at origin), distribute evenly around full circle
    // For non-root, bias toward direction away from grandparent
    const baseAngle = depth === 0 ? 0 : carg(parent.z);

    // More children = wider spread (up to full circle)
    const childCount = children.length;
    const totalSpread = Math.min(Math.PI * 2, (Math.PI * 0.8) * Math.sqrt(childCount + 1));
    const angleStep = childCount > 0 ? totalSpread / childCount : 0;
    const startAngle = baseAngle - totalSpread / 2 + angleStep / 2;

    children.forEach((cid, i) => {
      const child = nodes.get(cid);
      if (!child || visited.has(cid)) return;

      visited.add(cid);
      const angle = startAngle + i * angleStep;

      // Place child along geodesic from parent
      // First, compute target position in parent-centered coordinates
      const localZ = cpolar(eucRadius, angle);

      // Transform to world coordinates via inverse Möbius
      // This places child along the geodesic from parent at proper hyperbolic distance
      child.z = clampDisk(mobiusInv(parent.z, localZ), 0.02);

      queue.push(cid);
    });
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn('layoutHyperbolic: hit iteration limit, possible cycle in graph');
  }
}

/**
 * Recompute layout for a subtree using hyperbolic geometry.
 * Called after node creation/reparenting to maintain geometric consistency.
 *
 * @param graph - The graph containing the subtree
 * @param rootId - The root of the subtree to relayout
 */
function relayoutSubtree(graph, rootId) {
  if (!graph || !graph.nodes) return;

  const root = graph.nodes.get(rootId);
  if (!root) return;

  const queue = [rootId];
  const visited = new Set([rootId]);
  let iterations = 0;

  while (queue.length && iterations < MAX_ITERATIONS) {
    iterations++;
    const pid = queue.shift();
    const parent = graph.nodes.get(pid);

    if (!parent || !parent.children || parent.children.length === 0) continue;

    const children = parent.children;

    // Slightly tighter hyperbolic radius for subtree relayout
    const hypRadius = 0.35;
    const eucRadius = Math.tanh(hypRadius / 2);

    // Base angle from parent's position (away from origin)
    const baseAngle = carg(parent.z);

    const childCount = children.length;
    const totalSpread = Math.min(Math.PI * 2, Math.PI * 0.7 * Math.sqrt(childCount + 1));
    const angleStep = childCount > 0 ? totalSpread / childCount : 0;
    const startAngle = baseAngle - totalSpread / 2 + angleStep / 2;

    children.forEach((cid, i) => {
      const child = graph.nodes.get(cid);
      if (!child || visited.has(cid)) return;

      visited.add(cid);
      const angle = startAngle + i * angleStep;
      const localZ = cpolar(eucRadius, angle);
      child.z = clampDisk(mobiusInv(parent.z, localZ), 0.02);
      queue.push(cid);
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MULTI-PIN CLUSTERING (Distance reweighting around pinned nodes)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Relayout nodes around pinned anchors.
 * Pinned nodes act as gravitational centers that pull related nodes closer.
 * This preserves the hyperbolic structure while allowing user-driven organization.
 *
 * Optimization: Uses spatial bucketing to reduce O(n²) repulsion to O(n·k)
 * where k is average number of nearby nodes.
 */
function relayoutAroundPins(graph, strength = 0.3, iterations = 20) {
  if (!graph || !graph.nodes) return;

  const nodes = [...graph.nodes.values()];
  const pinned = nodes.filter(n => n.pinned);

  if (pinned.length === 0) return;

  // Validate parameters
  strength = clampNumber(strength, 0, 1);
  iterations = clampNumber(Math.floor(iterations), 1, 100);

  // Pre-compute relationship cache for performance
  const relationCache = new Map();
  const getRelated = (nodeId, pinId) => {
    const key = `${nodeId}-${pinId}`;
    if (!relationCache.has(key)) {
      relationCache.set(key, isRelated(graph, nodeId, pinId));
    }
    return relationCache.get(key);
  };

  // Build spatial index for efficient neighbor queries
  // Bucket nodes by their approximate position
  const BUCKET_SIZE = 0.1; // Hyperbolic distance bucket
  const buildSpatialIndex = () => {
    const buckets = new Map();
    for (const node of nodes) {
      if (!isValidComplex(node.z)) continue;
      // Quantize position to bucket
      const bx = Math.floor(node.z.re / BUCKET_SIZE);
      const by = Math.floor(node.z.im / BUCKET_SIZE);
      const key = `${bx},${by}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(node);
    }
    return buckets;
  };

  // Get nearby nodes from spatial index (checks 3x3 neighborhood)
  const getNearbyNodes = (node, buckets) => {
    const bx = Math.floor(node.z.re / BUCKET_SIZE);
    const by = Math.floor(node.z.im / BUCKET_SIZE);
    const nearby = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${bx + dx},${by + dy}`;
        const bucket = buckets.get(key);
        if (bucket) nearby.push(...bucket);
      }
    }
    return nearby;
  };

  // Iterative relaxation
  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map();
    nodes.forEach(n => forces.set(n.id, C(0, 0)));

    // Build spatial index for this iteration
    const spatialIndex = buildSpatialIndex();

    // Compute forces from pinned nodes (O(n·p) where p = # of pins)
    for (const node of nodes) {
      if (node.pinned || !isValidComplex(node.z)) continue;

      for (const pin of pinned) {
        if (!isValidComplex(pin.z)) continue;

        // Check if node is related to pin (same subtree or connected)
        const related = getRelated(node.id, pin.id);
        const dist = hypDist(node.z, pin.z);

        if (!isValidNumber(dist) || dist === Infinity) continue;

        if (related && dist > 0.01) {
          // Attractive force toward related pin
          const direction = cnorm(csub(pin.z, node.z));
          const forceMag = strength * (1 - Math.exp(-dist)) * (1 / pinned.length);
          const force = cscale(direction, forceMag);
          forces.set(node.id, cadd(forces.get(node.id), force));
        } else if (!related && dist < 0.8) {
          // Mild repulsive force from unrelated pins
          const direction = cnorm(csub(node.z, pin.z));
          const forceMag = strength * 0.2 * Math.exp(-dist * 2);
          const force = cscale(direction, forceMag);
          forces.set(node.id, cadd(forces.get(node.id), force));
        }
      }

      // Optimized repulsion: only check nearby nodes (O(n·k) instead of O(n²))
      const nearby = getNearbyNodes(node, spatialIndex);
      for (const other of nearby) {
        if (other.id === node.id || other.pinned) continue;
        if (!isValidComplex(other.z)) continue;

        const dist = hypDist(node.z, other.z);
        if (!isValidNumber(dist)) continue;

        // Only apply repulsion for close nodes
        const REPULSION_THRESHOLD = 0.2;
        if (dist < REPULSION_THRESHOLD && dist > EPSILON) {
          const direction = cnorm(csub(node.z, other.z));
          // Stronger repulsion for very close nodes
          const forceMag = 0.05 * (REPULSION_THRESHOLD - dist) / REPULSION_THRESHOLD;
          const force = cscale(direction, forceMag);
          forces.set(node.id, cadd(forces.get(node.id), force));
        }
      }
    }

    // Apply forces with damping (decreases over iterations for convergence)
    const damping = 1 - (iter / iterations) * 0.5;
    for (const node of nodes) {
      if (node.pinned) continue;

      const force = forces.get(node.id);
      if (!isValidComplex(force)) continue;

      const forceMag = cabs(force);
      if (forceMag < EPSILON) continue;

      // Clamp force magnitude to prevent instability
      const maxForce = 0.5;
      const clampedForce = forceMag > maxForce
        ? cscale(cnorm(force), maxForce)
        : force;

      const moveScale = 0.1 * damping;

      // Move in hyperbolic space using Möbius translation
      const offset = cscale(clampedForce, moveScale);
      const newPos = mobiusInv(cscale(offset, -1), node.z);

      if (isValidComplex(newPos)) {
        node.z = clampDisk(newPos, 0.01);
      }
    }
  }

  // If using Lorentz, update those positions too
  if (window.LorentzGeometry) {
    const L = window.LorentzGeometry;
    nodes.forEach(n => {
      if (isValidComplex(n.z)) {
        n.lorentz = L.fromPoincareDisk(n.z);
      }
    });
  }
}

/**
 * Check if two nodes are related (in same subtree or directly connected).
 */
function isRelated(graph, nodeId, pinId, maxDepth = 3) {
  const node = graph.nodes.get(nodeId);
  const pin = graph.nodes.get(pinId);
  if (!node || !pin) return false;

  // Check if one is ancestor of the other
  let current = node;
  for (let i = 0; i < maxDepth; i++) {
    if (current.id === pinId) return true;
    if (current.parent === null) break;
    current = graph.nodes.get(current.parent);
    if (!current) break;
  }

  current = pin;
  for (let i = 0; i < maxDepth; i++) {
    if (current.id === nodeId) return true;
    if (current.parent === null) break;
    current = graph.nodes.get(current.parent);
    if (!current) break;
  }

  // Check if they share a common ancestor within maxDepth
  const nodeAncestors = new Set();
  current = node;
  for (let i = 0; i < maxDepth; i++) {
    nodeAncestors.add(current.id);
    if (current.parent === null) break;
    current = graph.nodes.get(current.parent);
    if (!current) break;
  }

  current = pin;
  for (let i = 0; i < maxDepth; i++) {
    if (nodeAncestors.has(current.id)) return true;
    if (current.parent === null) break;
    current = graph.nodes.get(current.parent);
    if (!current) break;
  }

  return false;
}

/**
 * Get all pinned nodes grouped by their cluster relationships.
 * Returns array of { pin: node, members: [nodeIds] }
 */
function getPinClusters(graph) {
  const nodes = [...graph.nodes.values()];
  const pinned = nodes.filter(n => n.pinned);

  return pinned.map(pin => {
    const members = nodes
      .filter(n => !n.pinned && isRelated(graph, n.id, pin.id))
      .map(n => n.id);
    return { pin, members };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// FOLD SYSTEM (Pressure shaping - collapse work into bounded, nameable shapes)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// NODE MANIPULATION
// ════════════════════════════════════════════════════════════════════════════

let nodeIdCounter = 1000; // Start high to avoid conflicts with generated nodes

/**
 * Create a new node in the current graph
 */
function createNode(options = {}) {
  const graph = currentGraph();
  const id = options.id || `node_${++nodeIdCounter}_${Date.now()}`;

  const node = {
    id,
    name: options.name || 'New Node',
    type: options.type || 'custom',
    icon: options.icon || '◆',
    tags: options.tags || [],
    depth: 0,
    parent: options.parent ?? null,
    children: [],
    z: options.z || C(0, 0),
    pinned: options.pinned || false,
    hidden: false,
    collapsed: false,
    editable: options.editable !== false,
    action: options.action || null, // Executable function
    data: options.data || {},       // Custom data payload
    content: options.content || ''  // Description/notes
  };

  // Calculate depth from parent
  if (node.parent !== null) {
    const parentNode = graph.nodes.get(node.parent);
    if (parentNode) {
      node.depth = parentNode.depth + 1;
      parentNode.children.push(id);
    }
  }

  graph.nodes.set(id, node);

  // Create edge to parent
  if (node.parent !== null) {
    graph.edges.push([node.parent, id]);
  }

  // Lift to Lorentz for advanced geometry
  if (window.LorentzGeometry) {
    liftToLorentz(graph);
  }

  // Track for persistence and undo
  trackNodeCreation(node, state.currentSpace);
  pushUndo({
    type: 'create',
    nodeId: id,
    node: { ...node, z: { re: node.z.re, im: node.z.im } },
    parentId: node.parent
  });

  // Invalidate render caches since graph structure changed
  invalidateRenderCache();
  invalidateHitTestCache();

  updatePanel();
  updateStats();

  console.log(`Created node: ${node.name} (${id})`);
  return node;
}

/**
 * Delete a node and its descendants
 */
function deleteNode(id) {
  const graph = currentGraph();
  const node = graph.nodes.get(id);
  if (!node) return false;

  // Collect all descendants for undo
  const toDelete = [id];
  const deletedNodes = [];
  const queue = [...node.children];
  while (queue.length > 0) {
    const childId = queue.shift();
    toDelete.push(childId);
    const child = graph.nodes.get(childId);
    if (child) queue.push(...child.children);
  }

  // Collect nodes and edges for undo before deleting
  for (const nid of toDelete) {
    const n = graph.nodes.get(nid);
    if (n) {
      deletedNodes.push({ ...n, z: { re: n.z.re, im: n.z.im } });
    }
  }
  const deletedEdges = graph.edges.filter(([a, b]) =>
    toDelete.includes(a) || toDelete.includes(b)
  );

  // Remove from parent's children
  if (node.parent !== null) {
    const parent = graph.nodes.get(node.parent);
    if (parent) {
      parent.children = parent.children.filter(c => c !== id);
    }
  }

  // Delete nodes
  toDelete.forEach(nid => {
    graph.nodes.delete(nid);
    trackNodeDeletion(nid);
  });

  // Remove edges involving deleted nodes
  graph.edges = graph.edges.filter(([a, b]) =>
    !toDelete.includes(a) && !toDelete.includes(b)
  );

  // Push undo action
  pushUndo({
    type: 'delete',
    nodes: deletedNodes,
    edges: deletedEdges,
    parentId: node.parent
  });

  // Update focus if deleted node was focused
  if (toDelete.includes(state.focus)) {
    state.focus = node.parent ?? 0;
  }

  // Remove from selection
  toDelete.forEach(nid => state.selected.delete(nid));

  // Invalidate render caches since graph structure changed
  invalidateRenderCache();
  invalidateHitTestCache();

  updatePanel();
  updateStats();
  return true;
}

/**
 * Link two nodes (create edge)
 */
function linkNodes(fromId, toId) {
  const graph = currentGraph();
  const from = graph.nodes.get(fromId);
  const to = graph.nodes.get(toId);
  if (!from || !to) return false;

  // Check if edge already exists
  const exists = graph.edges.some(([a, b]) =>
    (a === fromId && b === toId) || (a === toId && b === fromId)
  );
  if (exists) return false;

  graph.edges.push([fromId, toId]);
  trackLinkCreation(fromId, toId, state.currentSpace);
  return true;
}

/**
 * Reparent a node (move to new parent)
 */
function reparentNode(nodeId, newParentId) {
  const graph = currentGraph();
  const node = graph.nodes.get(nodeId);
  const newParent = graph.nodes.get(newParentId);
  if (!node || !newParent) return false;

  // Remove from old parent
  if (node.parent !== null) {
    const oldParent = graph.nodes.get(node.parent);
    if (oldParent) {
      oldParent.children = oldParent.children.filter(c => c !== nodeId);
    }
  }

  // Add to new parent
  node.parent = newParentId;
  newParent.children.push(nodeId);

  // Update depth recursively
  function updateDepth(n, d) {
    n.depth = d;
    n.children.forEach(cid => {
      const child = graph.nodes.get(cid);
      if (child) updateDepth(child, d + 1);
    });
  }
  updateDepth(node, newParent.depth + 1);

  // Update edges
  graph.edges = graph.edges.filter(([a, b]) =>
    !(a === node.parent && b === nodeId) && !(a === nodeId && b === node.parent)
  );
  graph.edges.push([newParentId, nodeId]);

  // Relayout the moved subtree along geodesics from new parent
  relayoutSubtree(graph, newParentId);

  updatePanel();
  return true;
}

/**
 * Rename a node
 */
function renameNode(nodeId, newName) {
  const graph = currentGraph();
  const node = graph.nodes.get(nodeId);
  if (!node) return false;

  const oldName = node.name;
  node.name = newName;

  trackNodeEdit(nodeId, { name: newName });
  pushUndo({
    type: 'rename',
    nodeId,
    oldName,
    newName
  });

  updatePanel();
  return true;
}

/**
 * Set node content (description/notes)
 */
function setNodeContent(nodeId, content) {
  const graph = currentGraph();
  const node = graph.nodes.get(nodeId);
  if (!node) return false;

  const oldContent = node.content || '';
  node.content = content;

  trackNodeEdit(nodeId, { content });
  pushUndo({
    type: 'content',
    nodeId,
    oldContent,
    newContent: content
  });

  updatePanel();
  return true;
}

/**
 * Set node action (executable function)
 */
function setNodeAction(nodeId, action) {
  const graph = currentGraph();
  const node = graph.nodes.get(nodeId);
  if (!node) return false;
  node.action = action;
  trackNodeEdit(nodeId, { action: action });
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// FOLDS (Work Compression)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Folds are bounded, nameable shapes that contain compressed work.
 * A fold preserves internal geometry and relationships.
 * Unfolding restores the original pressure/context.
 */

// Global fold storage - persists across sessions
const folds = new Map(); // foldId -> { name, nodes: [...], edges: [...], centroid, created }
let foldIdCounter = 0;

/**
 * Fold: Compress selected nodes into a bounded shape.
 * Returns the fold ID.
 */
function fold(graph, nodeIds, name = null) {
  if (!nodeIds || nodeIds.length === 0) return null;

  const foldId = `fold_${++foldIdCounter}_${Date.now()}`;
  const nodesToFold = nodeIds.map(id => graph.nodes.get(id)).filter(Boolean);

  if (nodesToFold.length === 0) return null;

  // Compute centroid of nodes being folded
  let centroid;
  if (window.LorentzGeometry) {
    centroid = computeLorentzCentroid(graph, nodeIds);
  } else {
    // Euclidean fallback
    let sumRe = 0, sumIm = 0;
    nodesToFold.forEach(n => { sumRe += n.z.re; sumIm += n.z.im; });
    const count = nodesToFold.length;
    centroid = clampDisk(C(sumRe / count, sumIm / count), 0.02);
  }

  // Store the fold with full internal state
  const foldData = {
    id: foldId,
    name: name || `Fold ${foldIdCounter}`,
    created: new Date().toISOString(),
    centroid: { re: centroid.re, im: centroid.im },
    nodes: nodesToFold.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
      icon: n.icon,
      tags: [...(n.tags || [])],
      depth: n.depth,
      parent: n.parent,
      children: [...n.children],
      z: { re: n.z.re, im: n.z.im },
      // Store position relative to centroid for restoration
      relativeZ: { re: n.z.re - centroid.re, im: n.z.im - centroid.im }
    })),
    edges: graph.edges.filter(([a, b]) =>
      nodeIds.includes(a) || nodeIds.includes(b)
    ),
    // Store which nodes connect the fold to the rest of the graph
    boundaryNodes: nodeIds.filter(id => {
      const node = graph.nodes.get(id);
      return node && (
        !nodeIds.includes(node.parent) ||
        node.children.some(c => !nodeIds.includes(c))
      );
    })
  };

  folds.set(foldId, foldData);

  // Create a fold node to represent the collapsed cluster
  const foldNode = {
    id: foldId,
    name: foldData.name,
    type: 'fold',
    icon: '◈',
    tags: ['fold', `${nodesToFold.length} nodes`],
    depth: Math.min(...nodesToFold.map(n => n.depth)),
    parent: null, // Will be set based on boundary
    children: [],
    z: centroid,
    pinned: false,
    hidden: false,
    collapsed: false,
    isFold: true,
    foldId: foldId,
    foldSize: nodesToFold.length
  };

  // Find best parent for fold node (common ancestor of boundary nodes)
  if (foldData.boundaryNodes.length > 0) {
    const firstBoundary = graph.nodes.get(foldData.boundaryNodes[0]);
    if (firstBoundary && firstBoundary.parent !== null) {
      const parentNode = graph.nodes.get(firstBoundary.parent);
      if (parentNode && !nodeIds.includes(parentNode.id)) {
        foldNode.parent = parentNode.id;
      }
    }
  }

  // Remove folded nodes from graph (but keep in fold storage)
  nodeIds.forEach(id => {
    graph.nodes.delete(id);
  });

  // Remove edges involving folded nodes
  graph.edges = graph.edges.filter(([a, b]) =>
    !nodeIds.includes(a) && !nodeIds.includes(b)
  );

  // Add the fold node
  graph.nodes.set(foldId, foldNode);

  // Update parent's children list
  if (foldNode.parent !== null) {
    const parent = graph.nodes.get(foldNode.parent);
    if (parent) {
      // Remove folded nodes from parent's children
      parent.children = parent.children.filter(c => !nodeIds.includes(c));
      // Add fold node
      if (!parent.children.includes(foldId)) {
        parent.children.push(foldId);
      }
    }
  }

  console.log(`Folded ${nodesToFold.length} nodes into "${foldData.name}"`);
  return foldId;
}

/**
 * Unfold: Restore a folded cluster to its original form.
 */
function unfold(graph, foldId) {
  const foldData = folds.get(foldId);
  if (!foldData) {
    console.warn(`Fold ${foldId} not found`);
    return false;
  }

  const foldNode = graph.nodes.get(foldId);
  if (!foldNode) {
    console.warn(`Fold node ${foldId} not in graph`);
    return false;
  }

  // Get current position of fold node (user may have moved it)
  const currentCentroid = foldNode.z;

  // Restore all nodes with positions adjusted to current centroid
  foldData.nodes.forEach(nodeData => {
    const restoredNode = {
      ...nodeData,
      z: C(
        currentCentroid.re + nodeData.relativeZ.re,
        currentCentroid.im + nodeData.relativeZ.im
      ),
      pinned: false,
      hidden: false
    };
    // Clamp to disk
    restoredNode.z = clampDisk(restoredNode.z, 0.01);
    graph.nodes.set(nodeData.id, restoredNode);
  });

  // Restore edges
  foldData.edges.forEach(edge => {
    if (!graph.edges.some(e => e[0] === edge[0] && e[1] === edge[1])) {
      graph.edges.push(edge);
    }
  });

  // Restore parent-child relationships
  foldData.nodes.forEach(nodeData => {
    if (nodeData.parent !== null) {
      const parent = graph.nodes.get(nodeData.parent);
      if (parent && !parent.children.includes(nodeData.id)) {
        parent.children.push(nodeData.id);
      }
    }
  });

  // Remove the fold node
  graph.nodes.delete(foldId);

  // Update parent to remove fold node from children
  if (foldNode.parent !== null) {
    const parent = graph.nodes.get(foldNode.parent);
    if (parent) {
      parent.children = parent.children.filter(c => c !== foldId);
    }
  }

  // Keep fold in storage (can be refolded)
  // folds.delete(foldId); // Uncomment to remove fold from library

  console.log(`Unfolded "${foldData.name}" - restored ${foldData.nodes.length} nodes`);

  // Return first boundary node or first restored node for focus
  const focusTarget = foldData.boundaryNodes[0] || foldData.nodes[0]?.id;
  return focusTarget || true;
}

/**
 * Get all available folds (for fold library UI)
 */
function getFolds() {
  return [...folds.values()];
}

/**
 * Rename a fold
 */
function renameFold(foldId, newName) {
  const foldData = folds.get(foldId);
  if (foldData) {
    foldData.name = newName;
    const foldNode = currentGraph().nodes.get(foldId);
    if (foldNode) {
      foldNode.name = newName;
    }
    return true;
  }
  return false;
}

/**
 * Serialize folds for persistence
 */
function serializeFolds() {
  return JSON.stringify([...folds.entries()]);
}

/**
 * Restore folds from persistence
 */
function deserializeFolds(json) {
  try {
    const entries = JSON.parse(json);
    folds.clear();
    entries.forEach(([k, v]) => folds.set(k, v));
    foldIdCounter = Math.max(foldIdCounter, ...entries.map(([k]) =>
      parseInt(k.split('_')[1]) || 0
    ));
    return true;
  } catch (e) {
    console.error('Failed to restore folds:', e);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WITNESS CUT (Ethical accounting - acknowledge and release)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Witnesses are records of acknowledged work.
 * The Witness Cut requires acknowledgment before release.
 */
const witnesses = [];

/**
 * Generate a witness record of current state.
 */
function generateWitness() {
  const graph = currentGraph();
  const focused = graph.nodes.get(state.focus);
  const pinned = [...graph.nodes.values()].filter(n => n.pinned);
  const selected = [...state.selected].map(id => graph.nodes.get(id)).filter(Boolean);

  const witness = {
    timestamp: new Date().toISOString(),
    space: state.currentSpace,
    focus: focused ? { name: focused.name, type: focused.type } : null,
    pinned: pinned.map(n => n.name),
    selected: selected.map(n => n.name),
    recentPath: state.recent.slice(0, 5).map(id => graph.nodes.get(id)?.name).filter(Boolean),
    nodeCount: graph.nodes.size,
    foldCount: folds.size
  };

  return witness;
}

/**
 * Witness and Release - the ethical cut.
 * Requires acknowledgment before releasing current context.
 */
function witnessAndRelease() {
  const witness = generateWitness();

  // Build the witness text
  const lines = [
    '═══════════════════════════════════════════════════════',
    '                    WITNESS CUT',
    '═══════════════════════════════════════════════════════',
    '',
    `Time: ${new Date().toLocaleString()}`,
    `Space: ${SPACES[witness.space]?.name || witness.space}`,
    '',
    '─── What was I doing? ───',
    witness.focus ? `Focused on: ${witness.focus.name} (${witness.focus.type})` : 'No focus',
    witness.pinned.length > 0 ? `Anchored: ${witness.pinned.join(', ')}` : 'No anchors',
    witness.selected.length > 0 ? `Selected: ${witness.selected.join(', ')}` : 'No selection',
    '',
    '─── What path led here? ───',
    witness.recentPath.length > 0 ? witness.recentPath.join(' → ') : 'No path recorded',
    '',
    '─── What remains? ───',
    `${witness.nodeCount} nodes in graph`,
    `${witness.foldCount} folds stored`,
    '',
    '═══════════════════════════════════════════════════════'
  ];

  const witnessText = lines.join('\n');

  // Show the witness and ask for acknowledgment
  const unresolved = prompt(
    witnessText + '\n\nWhat remains unresolved? (Leave blank to release without note)',
    ''
  );

  if (unresolved === null) {
    // User cancelled - don't release
    console.log('Witness cut cancelled');
    return false;
  }

  // Add unresolved note to witness
  witness.unresolved = unresolved || null;
  witness.acknowledged = true;

  // Store the witness
  witnesses.push(witness);

  // Persist witnesses to localStorage
  try {
    localStorage.setItem('umbra_witnesses', JSON.stringify(witnesses));
  } catch (e) {
    console.warn('Could not persist witness:', e);
  }

  // Release: clear selections, unpin, reset view
  state.selected.clear();
  for (const node of currentGraph().nodes.values()) {
    node.pinned = false;
  }
  state.targetCamera = C(0, 0);
  state.targetZoom = 1;
  state.velocity = C(0, 0);
  state.recent = [];

  updatePanel();
  updateBookmarks();
  updateSelectionBadge();

  console.log('Witness cut complete. Context released.');
  console.log('Witness:', witness);

  return true;
}

/**
 * Get all witnesses (for review/accountability)
 */
function getWitnesses() {
  return [...witnesses];
}

/**
 * Load witnesses from persistence
 */
function loadWitnesses() {
  try {
    const stored = localStorage.getItem('umbra_witnesses');
    if (stored) {
      const loaded = JSON.parse(stored);
      witnesses.length = 0;
      witnesses.push(...loaded);
    }
  } catch (e) {
    console.warn('Could not load witnesses:', e);
  }
}

// Load witnesses on startup
if (typeof localStorage !== 'undefined') {
  loadWitnesses();
}

// ════════════════════════════════════════════════════════════════════════════
// GRAPH PERSISTENCE - Save user modifications
// ════════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'umbra_graph_mods';

// Track modifications (new nodes, edits, custom links)
let graphModifications = {
  nodes: {},      // id -> node data (user-created/edited nodes)
  links: [],      // [from, to] pairs (user-created links)
  deletions: [],  // ids of deleted built-in nodes
  content: {},    // id -> content string (notes/descriptions)
  pins: {},       // id -> boolean (pin states)
  positions: {}   // id -> {re, im} (custom positions)
};

function saveGraphModifications() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(graphModifications));
  } catch (e) {
    console.warn('Could not save graph modifications:', e);
  }
}

function loadGraphModifications() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      graphModifications = JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Could not load graph modifications:', e);
  }
}

function applyModificationsToGraph(graph, spaceKey) {
  // Apply user-created nodes
  for (const [id, nodeData] of Object.entries(graphModifications.nodes)) {
    if (nodeData.space === spaceKey && !graph.nodes.has(id)) {
      const node = {
        ...nodeData,
        z: C(nodeData.z.re, nodeData.z.im),
        children: nodeData.children || []
      };
      graph.nodes.set(id, node);

      // Reconnect to parent
      if (node.parent !== null) {
        const parent = graph.nodes.get(node.parent);
        if (parent && !parent.children.includes(id)) {
          parent.children.push(id);
        }
      }
    }
  }

  // Apply user-created links
  for (const [from, to, space] of graphModifications.links) {
    if (space === spaceKey) {
      const exists = graph.edges.some(([a, b]) =>
        (a === from && b === to) || (a === to && b === from)
      );
      if (!exists && graph.nodes.has(from) && graph.nodes.has(to)) {
        graph.edges.push([from, to]);
      }
    }
  }

  // Apply content (descriptions)
  for (const [id, content] of Object.entries(graphModifications.content)) {
    const node = graph.nodes.get(id);
    if (node) node.content = content;
  }

  // Apply pin states
  for (const [id, pinned] of Object.entries(graphModifications.pins)) {
    const node = graph.nodes.get(id);
    if (node) node.pinned = pinned;
  }

  // Apply custom positions
  for (const [id, pos] of Object.entries(graphModifications.positions)) {
    const node = graph.nodes.get(id);
    if (node) node.z = C(pos.re, pos.im);
  }
}

function trackNodeCreation(node, spaceKey) {
  graphModifications.nodes[node.id] = {
    ...node,
    space: spaceKey,
    z: { re: node.z.re, im: node.z.im },
    action: null // Don't serialize functions
  };
  saveGraphModifications();
}

function trackNodeEdit(id, changes) {
  if (graphModifications.nodes[id]) {
    Object.assign(graphModifications.nodes[id], changes);
  } else {
    // Built-in node - just track specific changes
    if (changes.content !== undefined) {
      graphModifications.content[id] = changes.content;
    }
    if (changes.pinned !== undefined) {
      graphModifications.pins[id] = changes.pinned;
    }
    if (changes.z !== undefined) {
      graphModifications.positions[id] = { re: changes.z.re, im: changes.z.im };
    }
  }
  saveGraphModifications();
}

function trackLinkCreation(from, to, spaceKey) {
  graphModifications.links.push([from, to, spaceKey]);
  saveGraphModifications();
}

function trackNodeDeletion(id) {
  // If it's a user-created node, just remove from modifications
  if (graphModifications.nodes[id]) {
    delete graphModifications.nodes[id];
  } else {
    // Built-in node - track deletion
    graphModifications.deletions.push(id);
  }
  saveGraphModifications();
}

// Load modifications on startup
loadGraphModifications();

// ════════════════════════════════════════════════════════════════════════════
// EXPORT/IMPORT - Share and backup graphs
// ════════════════════════════════════════════════════════════════════════════

function exportGraph() {
  const exportData = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    modifications: graphModifications,
    witnesses: witnesses,
    folds: [...folds.entries()].map(([k, v]) => [k, v])
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `umbra-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('Graph exported');
}

function importGraph(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (data.modifications) {
        graphModifications = data.modifications;
        saveGraphModifications();
      }
      if (data.witnesses) {
        witnesses.length = 0;
        witnesses.push(...data.witnesses);
        saveWitnesses();
      }
      if (data.folds) {
        folds.clear();
        data.folds.forEach(([k, v]) => folds.set(k, v));
      }

      // Rebuild graphs with imported modifications
      Object.keys(SPACES).forEach(key => {
        state.graphs[key] = buildGraph(key);
        applyModificationsToGraph(state.graphs[key], key);
        liftToLorentz(state.graphs[key]);
      });

      showToast('Graph imported - refresh to see changes');
      updatePanel();
      updateStats();
    } catch (err) {
      showToast('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// Add keyboard shortcut for export
function handleExportShortcut() {
  exportGraph();
}

// ════════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE PERSISTENCE SYSTEM
// Handles settings, camera state, auto-save, and version migration
// ════════════════════════════════════════════════════════════════════════════

const PERSISTENCE_VERSION = 2;  // Increment when storage format changes
const SETTINGS_KEY = 'umbra_settings';
const CAMERA_KEY = 'umbra_camera';
const AUTO_SAVE_DELAY = 2000;  // Debounce delay in ms

let autoSaveTimeout = null;
let persistenceInitialized = false;

// Default settings for reset/migration
const DEFAULT_SETTINGS = {
  theme: 'default',
  features: {
    labels: true,
    geodesics: true,
    grid: false,
    depthColors: true,
    animations: true,
    momentum: true,
    hover: true,
    showContent: true,
  },
  overlays: {
    voronoi: false,
    tiling: false,
    transport: false,
    hypercycles: false,
    horocycles: false,
    idealPoints: false,
    circumcircles: false,
    tilingPQ: [7, 3],
    observables: true,
  },
  minimaps: {
    poincare: true,
    klein: false,
    halfplane: false,
    tree: false,
  },
  hud: {
    metrics: true,
    coords: false,
    panel: true,
  },
  view: {
    projection: 'poincare',
    viewMode: 'focus',
    autoZoom: true,
  }
};

/**
 * Save settings to localStorage with version tag.
 * Uses deep merge to preserve new default properties.
 */
function saveSettings() {
  if (!persistenceInitialized) return;  // Don't save during init
  try {
    const data = {
      version: PERSISTENCE_VERSION,
      timestamp: Date.now(),
      settings: state.settings
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    console.log('[Persistence] Settings saved');
  } catch (e) {
    console.warn('[Persistence] Could not save settings:', e.message);
  }
}

/**
 * Load settings from localStorage with migration support.
 * Merges loaded settings with defaults to handle new properties.
 */
function loadSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) {
      console.log('[Persistence] No saved settings, using defaults');
      return;
    }

    const data = JSON.parse(stored);

    // Version migration
    if (!data.version || data.version < PERSISTENCE_VERSION) {
      console.log('[Persistence] Migrating settings from version', data.version || 1, 'to', PERSISTENCE_VERSION);
      // Handle specific migrations as needed
      // For now, just merge with defaults which adds new properties
    }

    // Deep merge saved settings into state.settings
    const saved = data.settings || data;  // Handle old format without wrapper
    deepMergeSettings(state.settings, saved);

    console.log('[Persistence] Settings loaded', data.version ? `(v${data.version})` : '(legacy)');
  } catch (e) {
    console.warn('[Persistence] Could not load settings:', e.message);
  }
}

/**
 * Deep merge source into target, preserving target structure.
 * Only copies properties that exist in target (prevents pollution).
 */
function deepMergeSettings(target, source) {
  if (!source || typeof source !== 'object') return;

  for (const key of Object.keys(target)) {
    if (key in source) {
      if (typeof target[key] === 'object' && target[key] !== null && !Array.isArray(target[key])) {
        deepMergeSettings(target[key], source[key]);
      } else {
        // Direct assignment for primitives and arrays
        target[key] = source[key];
      }
    }
  }
}

/**
 * Save camera state for session continuity.
 */
function saveCamera() {
  if (!persistenceInitialized) return;
  try {
    const data = {
      camera: { re: state.camera.re, im: state.camera.im },
      zoom: state.zoom,
      focus: state.focus,
      currentSpace: state.currentSpace
    };
    localStorage.setItem(CAMERA_KEY, JSON.stringify(data));
  } catch (e) {
    // Silent fail for camera - not critical
  }
}

/**
 * Load camera state on startup.
 */
function loadCamera() {
  try {
    const stored = localStorage.getItem(CAMERA_KEY);
    if (!stored) return;

    const data = JSON.parse(stored);

    // Validate and apply camera position
    if (data.camera && isValidNumber(data.camera.re) && isValidNumber(data.camera.im)) {
      const mag = Math.sqrt(data.camera.re * data.camera.re + data.camera.im * data.camera.im);
      if (mag < 0.999) {  // Must be inside disk
        state.camera = C(data.camera.re, data.camera.im);
        state.targetCamera = C(data.camera.re, data.camera.im);
      }
    }

    // Validate and apply zoom
    if (isValidNumber(data.zoom) && data.zoom > 0.1 && data.zoom < 10) {
      state.zoom = data.zoom;
      state.targetZoom = data.zoom;
    }

    // Validate and apply focus
    if (typeof data.focus === 'number' && data.focus >= 0) {
      state.focus = data.focus;
    }

    // Validate and apply current space
    if (data.currentSpace && SPACES && SPACES[data.currentSpace]) {
      state.currentSpace = data.currentSpace;
    }

    console.log('[Persistence] Camera state restored');
  } catch (e) {
    console.warn('[Persistence] Could not load camera:', e.message);
  }
}

/**
 * Debounced auto-save - triggers after user stops making changes.
 */
function scheduleAutoSave() {
  if (!persistenceInitialized) return;

  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
  }

  autoSaveTimeout = setTimeout(() => {
    saveSettings();
    saveCamera();
    autoSaveTimeout = null;
  }, AUTO_SAVE_DELAY);
}

/**
 * Reset all persistence to defaults.
 * Clears localStorage and resets state.
 */
function resetPersistence() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(CAMERA_KEY);
    localStorage.removeItem('umbra_witnesses');
    localStorage.removeItem('umbra-theme');

    // Reset graph modifications
    graphModifications = {
      nodes: {},
      links: [],
      deletions: [],
      content: {},
      pins: {},
      positions: {}
    };

    // Reset settings to defaults
    deepMergeSettings(state.settings, DEFAULT_SETTINGS);

    // Reset camera
    state.camera = C(0, 0);
    state.targetCamera = C(0, 0);
    state.zoom = 1.0;
    state.targetZoom = 1.0;
    state.focus = 0;

    showToast('All data cleared - refresh to reload defaults');
    console.log('[Persistence] All data reset');
  } catch (e) {
    console.warn('[Persistence] Could not reset:', e.message);
  }
}

/**
 * Get storage usage statistics.
 */
function getStorageStats() {
  const stats = {
    graphMods: 0,
    settings: 0,
    camera: 0,
    witnesses: 0,
    total: 0
  };

  try {
    const keys = [STORAGE_KEY, SETTINGS_KEY, CAMERA_KEY, 'umbra_witnesses'];
    keys.forEach(key => {
      const data = localStorage.getItem(key);
      if (data) {
        const size = new Blob([data]).size;
        if (key === STORAGE_KEY) stats.graphMods = size;
        else if (key === SETTINGS_KEY) stats.settings = size;
        else if (key === CAMERA_KEY) stats.camera = size;
        else if (key === 'umbra_witnesses') stats.witnesses = size;
        stats.total += size;
      }
    });
  } catch (e) {
    // Silent fail
  }

  return stats;
}

/**
 * Initialize persistence system.
 * Called after state is defined but before rendering starts.
 */
function initPersistence() {
  // Load in order: settings first, then camera (depends on currentSpace)
  loadSettings();
  loadCamera();

  persistenceInitialized = true;
  console.log('[Persistence] Initialized. Storage:',
    Math.round(getStorageStats().total / 1024), 'KB');
}

// Hook into settings changes for auto-save
// This will be called after state is defined
function hookSettingsAutoSave() {
  // Create a proxy to detect settings changes (for modern browsers)
  // Fallback: manual calls to scheduleAutoSave() after settings change
  if (typeof Proxy !== 'undefined') {
    const createSettingsProxy = (obj, path = '') => {
      return new Proxy(obj, {
        set(target, prop, value) {
          target[prop] = value;
          scheduleAutoSave();
          return true;
        },
        get(target, prop) {
          if (typeof target[prop] === 'object' && target[prop] !== null && !Array.isArray(target[prop])) {
            return createSettingsProxy(target[prop], path + prop + '.');
          }
          return target[prop];
        }
      });
    };
    // Note: This only works if we reassign state.settings
    // For now, rely on manual scheduleAutoSave() calls
  }
}

// ════════════════════════════════════════════════════════════════════════════
// INFRASTRUCTURE OBSERVABLES - Real-time status for infra nodes
// ════════════════════════════════════════════════════════════════════════════

// Observable registry - maps node names to their status/data sources
const infraObservables = {
  // Status polling configuration
  pollInterval: 10000, // 10 seconds
  lastPoll: 0,
  enabled: true,

  // Simulated endpoints (in real deployment, these would be actual URLs)
  endpoints: {
    'prometheus': { type: 'prometheus', url: '/api/prometheus/health' },
    'grafana': { type: 'http', url: '/api/grafana/health' },
    'nginx-lb-01': { type: 'http', url: '/api/nginx/lb01/status' },
    'nginx-lb-02': { type: 'http', url: '/api/nginx/lb02/status' },
    'postgres-primary': { type: 'postgres', url: '/api/db/primary/status' },
    'redis-cache-01': { type: 'redis', url: '/api/redis/01/status' },
    'jenkins-master': { type: 'http', url: '/api/jenkins/status' }
  },

  // Current status cache
  statusCache: new Map(),

  // Status colors
  statusColors: {
    healthy: '#7ee787',
    degraded: '#d29922',
    critical: '#f85149',
    unknown: '#6e7681'
  }
};

// Update infrastructure node statuses
function updateInfraObservables() {
  if (!infraObservables.enabled) return;

  const graph = state.graphs.infra;
  if (!graph) return;

  const now = Date.now();
  if (now - infraObservables.lastPoll < infraObservables.pollInterval) return;
  infraObservables.lastPoll = now;

  // In demo mode, simulate status changes
  for (const node of graph.nodes.values()) {
    if (!node.tags || node.tags.length === 0) continue;

    // Check if node has health-related tags
    const hasHealthTag = node.tags.some(t =>
      ['healthy', 'degraded', 'critical', 'warning'].includes(t)
    );
    if (!hasHealthTag) continue;

    // Simulate occasional status changes (5% chance)
    if (Math.random() < 0.05) {
      const oldStatus = node.tags.find(t => ['healthy', 'degraded', 'critical'].includes(t));
      const statusOptions = ['healthy', 'healthy', 'healthy', 'degraded', 'critical'];
      const newStatus = statusOptions[Math.floor(Math.random() * statusOptions.length)];

      if (oldStatus !== newStatus) {
        // Update tags
        node.tags = node.tags.filter(t => !['healthy', 'degraded', 'critical'].includes(t));
        node.tags.unshift(newStatus);

        // Cache status change
        infraObservables.statusCache.set(node.id, {
          status: newStatus,
          changedAt: now,
          previous: oldStatus
        });

        // Show notification for critical changes
        if (newStatus === 'critical' || (oldStatus === 'critical' && newStatus !== 'critical')) {
          const emoji = newStatus === 'critical' ? '🔴' : '🟢';
          showToast(`${emoji} ${node.name}: ${newStatus}`);
        }
      }
    }
  }
}

// Get observable status for a node
function getNodeObservableStatus(node) {
  if (!node.tags) return null;

  const cached = infraObservables.statusCache.get(node.id);
  const status = node.tags.find(t => ['healthy', 'degraded', 'critical'].includes(t));

  return {
    status: status || 'unknown',
    color: infraObservables.statusColors[status] || infraObservables.statusColors.unknown,
    recentChange: cached && (Date.now() - cached.changedAt < 30000),
    changedFrom: cached?.previous
  };
}

// Poll real endpoint (for production use)
async function pollEndpoint(nodeName) {
  const endpoint = infraObservables.endpoints[nodeName];
  if (!endpoint) return null;

  try {
    const response = await fetch(endpoint.url, {
      method: 'GET',
      timeout: 5000
    });

    if (response.ok) {
      const data = await response.json();
      return {
        status: data.status || 'healthy',
        metrics: data.metrics || {},
        timestamp: Date.now()
      };
    } else {
      return { status: 'degraded', error: response.status };
    }
  } catch (e) {
    return { status: 'critical', error: e.message };
  }
}

// Register custom observable for a node
function registerObservable(nodeName, config) {
  infraObservables.endpoints[nodeName] = config;
}

// Start polling observables
let observablePollTimer = null;

function startObservablePolling() {
  if (observablePollTimer) return;
  observablePollTimer = setInterval(() => {
    if (state.currentSpace === 'infra' && state.settings.overlays.observables) {
      updateInfraObservables();
    }
  }, 2000);
}

function stopObservablePolling() {
  if (observablePollTimer) {
    clearInterval(observablePollTimer);
    observablePollTimer = null;
  }
}

// Start polling on load
startObservablePolling();

// ════════════════════════════════════════════════════════════════════════════
// GRAPH UNDO/REDO - Track modifications for undo
// ════════════════════════════════════════════════════════════════════════════

const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

function pushUndo(action) {
  undoStack.push(action);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0; // Clear redo on new action
}

function undo() {
  if (undoStack.length === 0) return;
  const action = undoStack.pop();
  redoStack.push(action);

  const graph = currentGraph();
  switch (action.type) {
    case 'create':
      // Undo create = delete
      graph.nodes.delete(action.nodeId);
      graph.edges = graph.edges.filter(([a, b]) => a !== action.nodeId && b !== action.nodeId);
      if (action.parentId) {
        const parent = graph.nodes.get(action.parentId);
        if (parent) parent.children = parent.children.filter(c => c !== action.nodeId);
      }
      delete graphModifications.nodes[action.nodeId];
      break;
    case 'delete':
      // Undo delete = restore
      for (const node of action.nodes) {
        graph.nodes.set(node.id, { ...node, z: C(node.z.re, node.z.im) });
      }
      for (const edge of action.edges) {
        graph.edges.push(edge);
      }
      break;
    case 'rename':
      const node = graph.nodes.get(action.nodeId);
      if (node) node.name = action.oldName;
      break;
    case 'content':
      const cnode = graph.nodes.get(action.nodeId);
      if (cnode) cnode.content = action.oldContent;
      break;
  }

  saveGraphModifications();
  updatePanel();
  updateStats();
  showToast('Undo: ' + action.type);
}

function redo() {
  if (redoStack.length === 0) return;
  const action = redoStack.pop();
  undoStack.push(action);

  const graph = currentGraph();
  switch (action.type) {
    case 'create':
      graph.nodes.set(action.nodeId, action.node);
      if (action.parentId) {
        const parent = graph.nodes.get(action.parentId);
        if (parent) parent.children.push(action.nodeId);
      }
      break;
    case 'delete':
      for (const node of action.nodes) {
        graph.nodes.delete(node.id);
      }
      graph.edges = graph.edges.filter(e => !action.edges.includes(e));
      break;
    case 'rename':
      const node = graph.nodes.get(action.nodeId);
      if (node) node.name = action.newName;
      break;
    case 'content':
      const cnode = graph.nodes.get(action.nodeId);
      if (cnode) cnode.content = action.newContent;
      break;
  }

  saveGraphModifications();
  updatePanel();
  updateStats();
  showToast('Redo: ' + action.type);
}

// ════════════════════════════════════════════════════════════════════════════
// LORENTZ INTEGRATION (High-dimensional hyperbolic geometry)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lift all nodes to Lorentz representation for higher-dimensional operations.
 * The 2D Poincaré disk position is preserved in node.z for rendering,
 * while node.lorentz holds the full H^8 representation.
 */
function liftToLorentz(graph) {
  if (!window.LorentzGeometry) {
    return; // Silent skip - not required for core functionality
  }

  try {
    const L = window.LorentzGeometry;
    const points = [];
    const ids = [];

    for (const node of graph.nodes.values()) {
      if (!node.z || !isValidComplex(node.z)) continue;

      // Lift 2D position to H^8
      node.lorentz = L.fromPoincareDisk(node.z);
      if (node.lorentz) {
        points.push(node.lorentz);
        ids.push(node.id);
      }
    }

    // Build spatial index
    if (points.length > 0 && L.BallTree) {
      graph.ballTree = new L.BallTree(points, ids, 8);
    }
  } catch (e) {
    console.warn('[HyperbolicEngine] liftToLorentz failed:', e);
  }
}

/**
 * Compute hyperbolic centroid of a set of node IDs using Lorentz geometry.
 * Returns a Poincaré disk position for rendering.
 */
function computeLorentzCentroid(graph, nodeIds) {
  if (!window.LorentzGeometry) {
    // Fallback to Euclidean average
    let sumRe = 0, sumIm = 0, count = 0;
    for (const id of nodeIds) {
      const node = graph.nodes.get(id);
      if (node) {
        sumRe += node.z.re;
        sumIm += node.z.im;
        count++;
      }
    }
    return count > 0 ? C(sumRe / count, sumIm / count) : C(0, 0);
  }

  const L = window.LorentzGeometry;
  const points = [];

  for (const id of nodeIds) {
    const node = graph.nodes.get(id);
    if (node && node.lorentz) {
      points.push(node.lorentz);
    }
  }

  if (points.length === 0) return C(0, 0);

  const centroid = L.centroid(points);
  return L.toPoincareDisk(centroid);
}

/**
 * Find k nearest neighbors to a point using the ball tree.
 * Returns array of node IDs.
 */
function findNearestNodes(graph, z, k = 5) {
  if (!window.LorentzGeometry || !graph.ballTree) {
    // Fallback to brute force
    const distances = [];
    for (const node of graph.nodes.values()) {
      distances.push({ id: node.id, d: hypDist(z, node.z) });
    }
    distances.sort((a, b) => a.d - b.d);
    return distances.slice(0, k).map(x => x.id);
  }

  const L = window.LorentzGeometry;
  const query = L.fromPoincareDisk(z);
  return graph.ballTree.knn(query, k);
}

/**
 * Find all nodes within hyperbolic distance r of a point.
 */
function findNodesInRadius(graph, z, r) {
  if (!window.LorentzGeometry || !graph.ballTree) {
    // Fallback to brute force
    const results = [];
    for (const node of graph.nodes.values()) {
      if (hypDist(z, node.z) < r) {
        results.push(node.id);
      }
    }
    return results;
  }

  const L = window.LorentzGeometry;
  const query = L.fromPoincareDisk(z);
  return graph.ballTree.rangeQuery(query, r);
}

/**
 * Compute LOD level for a node based on camera distance.
 */
function getNodeLOD(node, cameraZ) {
  if (!window.LorentzGeometry || !node.lorentz) {
    // Fallback based on 2D distance
    const d = hypDist(cameraZ, node.z);
    return Math.min(4, Math.floor(Math.log2(Math.max(1, d / 0.3))));
  }

  const L = window.LorentzGeometry;
  const cameraLorentz = L.fromPoincareDisk(cameraZ);
  return L.computeLOD(cameraLorentz, node.lorentz, 4, 0.3);
}

// ════════════════════════════════════════════════════════════════════════════
// APPLICATION STATE
// ════════════════════════════════════════════════════════════════════════════

const state = {
  // Current space
  currentSpace: 'hyperbolic',
  graphs: {},

  // Camera
  camera: C(0, 0),
  targetCamera: C(0, 0),
  zoom: 1.0,
  targetZoom: 1.0,

  // Selection
  focus: 0,
  selected: new Set([0]),
  hovered: null,

  // Path measurement - multi-point path
  pathNodes: [],        // Array of node IDs in path
  pathAnimating: false,
  pathAnimT: 0,

  // Node editing
  linkDragFrom: null,   // Node ID when dragging to create link
  editingNode: null,    // Node being edited

  // Physics
  velocity: C(0, 0),
  friction: 0.88,

  // History
  history: [],
  historyIdx: -1,
  recent: [],

  // Interaction
  mode: 'pan', // pan, select, path
  dragging: false,
  dragStart: null,
  lastPointer: null,
  lastTime: 0,
  draggingNode: null,     // Node ID being dragged
  dragNodeStartZ: null,   // Original position of dragged node
  selectionRect: null,    // {x1, y1, x2, y2} for lasso selection

  // Settings - organized into logical groups
  settings: {
    // Theme: 'default', 'minimalist', 'skeuomorphic'
    theme: 'default',

    // VISUAL FEATURES (toggleable)
    features: {
      labels: true,        // node labels
      geodesics: true,     // curved edges vs straight
      grid: false,         // hyperbolic grid
      depthColors: true,   // depth-based coloring
      animations: true,    // smooth transitions
      momentum: true,      // inertial panning
      hover: true,         // hover effects
      showContent: true,   // Show content on canvas
    },

    // GEOMETRY OVERLAYS (all default off)
    overlays: {
      voronoi: false,
      tiling: false,
      transport: false,
      hypercycles: false,
      horocycles: false,
      idealPoints: false,
      circumcircles: false,
      tilingPQ: [7, 3],    // {p,q} tiling parameters
      observables: true,   // Infrastructure observables
    },

    // MINIMAPS (toggleable)
    minimaps: {
      poincare: true,      // main minimap (Poincaré disk)
      klein: false,        // Klein model (straight geodesics)
      halfplane: false,    // Upper half-plane model
      tree: false,         // tree layout
    },

    // HUD (toggleable)
    hud: {
      metrics: true,       // zoom, focus, etc
      coords: false,       // camera coordinates
      panel: true,         // side panel
    },

    // VIEW CONTROLS
    view: {
      projection: 'poincare',  // 'poincare', 'klein', 'halfplane' (Note: Klein/halfplane not yet implemented)
      viewMode: 'focus',       // 'focus', 'overview', 'tree'
      autoZoom: true,          // Auto-zoom to follow focus
    }
  },

  // UI
  focusMode: false,
  commandOpen: false,
  keyboardHintsOpen: false
};

// Initialize graphs for all spaces
console.log('[HyperbolicEngine] Building graphs for spaces:', Object.keys(SPACES));
Object.keys(SPACES).forEach(key => {
  state.graphs[key] = buildGraph(key);
  // Apply any saved user modifications
  applyModificationsToGraph(state.graphs[key], key);
  // Lift to Lorentz H^8 for advanced geometry operations
  liftToLorentz(state.graphs[key]);
});
console.log('[HyperbolicEngine] Graphs built. Node counts:', Object.fromEntries(
  Object.entries(state.graphs).map(([k, g]) => [k, g.nodes.size])
));

function currentGraph() {
  return state.graphs[state.currentSpace];
}

function currentSpace() {
  return SPACES[state.currentSpace];
}

// ════════════════════════════════════════════════════════════════════════════
// CANVAS SETUP
// ════════════════════════════════════════════════════════════════════════════

const canvas = document.getElementById('canvas');
if (!canvas) throw new Error('Canvas element #canvas not found');
const ctx = canvas.getContext('2d');
const miniCanvas = document.getElementById('minimap');
const miniCtx = miniCanvas ? miniCanvas.getContext('2d') : null;
const kleinCanvas = document.getElementById('minimap-klein');
const kleinCtx = kleinCanvas ? kleinCanvas.getContext('2d') : null;
const treeCanvas = document.getElementById('minimap-tree');
const treeCtx = treeCanvas ? treeCanvas.getContext('2d') : null;
const mainEl = document.getElementById('main');

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resize);
resize();

// ════════════════════════════════════════════════════════════════════════════
// COORDINATE TRANSFORMS (with projection support)
// ════════════════════════════════════════════════════════════════════════════

// Projection manager for multiple models (Poincaré, Klein, Half-plane)
let projectionManager = null;
try {
  if (window.HyperbolicProjections && window.HyperbolicProjections.ProjectionManager) {
    projectionManager = new window.HyperbolicProjections.ProjectionManager('poincare');
    console.log('[HyperbolicEngine] ProjectionManager initialized');
  }
} catch (e) {
  console.warn('[HyperbolicEngine] ProjectionManager init failed:', e);
}

function getDiskParams(W, H) {
  const R = Math.min(W, H) / 2 - CANVAS_PADDING;
  return { cx: W / 2, cy: H / 2, R };
}

function toScreen(z, W, H) {
  const { cx, cy, R } = getDiskParams(W, H);

  // Use projection manager if available and not in Poincaré mode
  if (projectionManager && state.settings.view.projection !== 'poincare') {
    const projected = projectionManager.fromPoincare(z);
    return projectionManager.toScreen(projected, cx, cy, R, state.zoom);
  }

  // Default Poincaré
  return {
    x: cx + z.re * R * state.zoom,
    y: cy + z.im * R * state.zoom
  };
}

function fromScreen(x, y, W, H) {
  const { cx, cy, R } = getDiskParams(W, H);

  // Use projection manager if available and not in Poincaré mode
  if (projectionManager && state.settings.view.projection !== 'poincare') {
    const modelPoint = projectionManager.fromScreen(x, y, cx, cy, R, state.zoom);
    return projectionManager.toPoincare(modelPoint);
  }

  // Default Poincaré
  return C(
    (x - cx) / (R * state.zoom),
    (y - cy) / (R * state.zoom)
  );
}

function transformNode(node) {
  return clampDisk(mobius(state.camera, node.z));
}

function nodeScreenPos(node, W, H) {
  return toScreen(transformNode(node), W, H);
}

/**
 * Get geodesic arc for current projection
 */
function getGeodesicArc(z1, z2) {
  if (projectionManager && state.settings.view.projection !== 'poincare') {
    projectionManager.setModel(state.settings.view.projection);
    const p1 = projectionManager.fromPoincare(z1);
    const p2 = projectionManager.fromPoincare(z2);
    return projectionManager.geodesicArc(p1, p2);
  }
  // Default to built-in geodesicArc
  return geodesicArc(z1, z2);
}

// ════════════════════════════════════════════════════════════════════════════
// RENDERING
// ════════════════════════════════════════════════════════════════════════════

let lastRenderTime = 0;
let animTime = 0; // Global animation time for loopy effects (in seconds)

// Render order cache - avoids O(n log n) sort every frame
let renderOrderCache = {
  sorted: null,           // Cached sorted array of {node, dist}
  cameraRe: 0,            // Camera position when cache was built
  cameraIm: 0,
  zoom: 1,
  nodeCount: 0,           // Track if nodes added/removed
  graphKey: null          // Current space key
};

const RENDER_CACHE_THRESHOLD = 0.01; // Camera movement threshold for rebuild

function invalidateRenderCache() {
  renderOrderCache.sorted = null;
}

function getRenderOrder(graph) {
  const cacheValid = renderOrderCache.sorted &&
    renderOrderCache.graphKey === state.currentSpace &&
    renderOrderCache.nodeCount === graph.nodes.size &&
    Math.abs(renderOrderCache.cameraRe - state.camera.re) < RENDER_CACHE_THRESHOLD &&
    Math.abs(renderOrderCache.cameraIm - state.camera.im) < RENDER_CACHE_THRESHOLD &&
    Math.abs(renderOrderCache.zoom - state.zoom) < RENDER_CACHE_THRESHOLD;

  if (!cacheValid) {
    // Rebuild sorted render order
    renderOrderCache.sorted = [...graph.nodes.values()]
      .filter(n => !n.hidden)
      .map(n => ({ node: n, dist: cabs2(transformNode(n)) }))
      .sort((a, b) => b.dist - a.dist);

    renderOrderCache.cameraRe = state.camera.re;
    renderOrderCache.cameraIm = state.camera.im;
    renderOrderCache.zoom = state.zoom;
    renderOrderCache.nodeCount = graph.nodes.size;
    renderOrderCache.graphKey = state.currentSpace;
  }

  return renderOrderCache.sorted;
}

let renderFrameCount = 0;
function render() {
  if (renderFrameCount === 0) console.log('[HyperbolicEngine] First render frame');
  renderFrameCount++;
  try {
    // Quick state validation
    if (!isValidComplex(state.camera)) state.camera = C(0, 0);
    if (!isValidComplex(state.targetCamera)) state.targetCamera = C(0, 0);
    if (!isFinite(state.zoom) || state.zoom <= 0) state.zoom = 1;
    if (!isFinite(state.targetZoom) || state.targetZoom <= 0) state.targetZoom = 1;

    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;

    if (W < 10 || H < 10) {
      requestAnimationFrame(render);
      return;
    }

    const now = performance.now();
    const elapsed = now - lastRenderTime;
    if (elapsed < FRAME_TIME_MS) {
      requestAnimationFrame(render);
      return;
    }
    lastRenderTime = now;
    animTime = now / 1000;

    // Physics (always)
    updatePhysics();
    ctx.clearRect(0, 0, W, H);

    // CORE (always)
    drawBackground(W, H);
    drawEdges(W, H);
    drawNodes(W, H);
    drawPath(W, H);
    drawSelectionRect(W, H);

    // OPTIONAL FEATURES (gated)
    if (state.settings.features.grid) drawGrid(W, H);

    // OPTIONAL OVERLAYS (gated)
    if (state.settings.overlays.voronoi) drawVoronoiOverlay(W, H);
    if (state.settings.overlays.tiling) drawTilingOverlay(W, H);
    if (state.settings.overlays.transport) drawTransportOverlay(W, H);
    if (state.settings.overlays.hypercycles) drawHypercyclesOverlay(W, H);
    if (state.settings.overlays.horocycles) drawHorocyclesOverlay(W, H);
    if (state.settings.overlays.idealPoints) drawIdealPointsOverlay(W, H);
    if (state.settings.overlays.circumcircles) drawCircumcirclesOverlay(W, H);

    // OPTIONAL MINIMAPS (gated)
    if (state.settings.minimaps.poincare || state.settings.minimaps.klein || state.settings.minimaps.halfplane || state.settings.minimaps.tree) {
      renderAllMinimaps();
    }

    // OPTIONAL HUD (gated)
    if (state.settings.hud.metrics || state.settings.hud.panel) updateHUD();
  } catch (e) {
    console.error('Render error:', e);
  }

  requestAnimationFrame(render);
}

function drawBackground(W, H) {
  const { cx, cy, R } = getDiskParams(W, H);
  const space = currentSpace();
  const theme = getThemeColors();
  const projection = state.settings.view.projection;

  // Fill canvas background
  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(0, 0, W, H);

  // Different boundary for each projection
  if (projection === 'halfplane') {
    // Upper half-plane: draw x-axis as the boundary (infinity)
    const boundaryY = cy + R;  // Bottom of the visible region

    // Gradient fading to boundary
    if (theme.nodeGlow) {
      const glow = ctx.createLinearGradient(0, cy - R, 0, boundaryY);
      glow.addColorStop(0, `${space.color}08`);
      glow.addColorStop(0.8, `${space.color}03`);
      glow.addColorStop(1, `${space.color}20`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, cy - R, W, R * 2);
    }

    // Draw the boundary line (x-axis / infinity)
    ctx.beginPath();
    ctx.moveTo(0, boundaryY);
    ctx.lineTo(W, boundaryY);
    ctx.strokeStyle = `${space.color}60`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    ctx.fillStyle = `${space.color}40`;
    ctx.font = '10px monospace';
    ctx.fillText('∞ (ideal boundary)', 10, boundaryY - 5);
  } else {
    // Poincaré or Klein disk
    // Ambient glow (skip for minimalist)
    if (theme.nodeGlow) {
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.3);
      glow.addColorStop(0, `${space.color}08`);
      glow.addColorStop(0.6, `${space.color}03`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }

    // Disk boundary with subtle breathing animation
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    // Gentle opacity pulse on boundary (8s period, very subtle)
    const boundaryAlpha = 0.35 + 0.1 * Math.sin(animTime * 0.785);
    const borderColor = theme.diskBorder.replace(/[\d.]+\)$/, `${boundaryAlpha})`);
    ctx.strokeStyle = theme.diskBorder.startsWith('rgba') ? borderColor : theme.diskBorder;
    ctx.lineWidth = state.settings.theme === 'minimalist' ? 2 : 1;
    ctx.stroke();

    // Inner gradient (skip for minimalist)
    if (theme.nodeGlow) {
      const inner = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R);
      inner.addColorStop(0, 'transparent');
      inner.addColorStop(1, `${space.color}08`);
      ctx.fillStyle = inner;
      ctx.fill();
    }

    // Label for Klein model
    if (projection === 'klein') {
      ctx.fillStyle = `${space.color}30`;
      ctx.font = '10px monospace';
      ctx.fillText('Klein (straight geodesics)', cx - 70, cy + R + 15);
    }
  }
}

function drawGrid(W, H) {
  // Note: gating done in render loop
  const { cx, cy, R } = getDiskParams(W, H);
  const theme = getThemeColors();

  ctx.strokeStyle = theme.gridColor;
  ctx.lineWidth = 1;

  // Hyperbolic circles (equidistant curves)
  for (let d = 0.5; d <= 3; d += 0.5) {
    const eucR = R * Math.tanh(d / 2) * state.zoom;
    if (eucR < R * 1.5) {
      ctx.beginPath();
      ctx.arc(cx, cy, eucR, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Radial geodesics
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(t), cy + R * Math.sin(t));
    ctx.stroke();
  }
}

function drawGeodesicEdge(z1, z2, W, H, color, alpha = 0.1, lineWidth = 1) {
  const p1 = toScreen(z1, W, H);
  const p2 = toScreen(z2, W, H);
  const { R } = getDiskParams(W, H);

  ctx.strokeStyle = color.replace(')', `,${alpha})`).replace('rgb', 'rgba').replace('#', '');
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
  } else {
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  }
  ctx.lineWidth = lineWidth;

  // Klein model: geodesics are straight lines
  if (state.settings.view.projection === 'klein' || !state.settings.features.geodesics) {
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    return;
  }

  // For Poincaré and half-plane: use proper geodesic arcs
  const arc = getGeodesicArc(z1, z2);
  if (!arc) return;

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

function drawEdges(W, H) {
  const graph = currentGraph();
  const theme = getThemeColors();

  // Edge color based on theme
  const edgeBaseColor = state.settings.theme === 'minimalist' ? '#404040' :
                        state.settings.theme === 'skeuomorphic' ? '#c8b8a0' : '#ffffff';

  for (const [aid, bid] of graph.edges) {
    const a = graph.nodes.get(aid);
    const b = graph.nodes.get(bid);
    if (!a || !b || a.hidden || b.hidden) continue;

    const za = transformNode(a);
    const zb = transformNode(b);

    // Cull edges outside view
    if (cabs(za) > 1.8 && cabs(zb) > 1.8) continue;

    // Alpha based on depth and distance (stronger for minimalist)
    const avgDepth = (a.depth + b.depth) / 2;
    const avgDist = (cabs(za) + cabs(zb)) / 2;
    const baseAlpha = state.settings.theme === 'minimalist' ? 0.4 : 0.12;
    const alpha = Math.max(0.05, baseAlpha - avgDepth * 0.008 - avgDist * 0.04);

    drawGeodesicEdge(za, zb, W, H, edgeBaseColor, alpha, state.settings.theme === 'minimalist' ? 1.5 : 1);
  }
}

function drawPath(W, H) {
  if (state.pathNodes.length === 0) return;

  const graph = currentGraph();
  const space = currentSpace();

  // Get all path node positions
  const pathPoints = state.pathNodes
    .map(id => graph.nodes.get(id))
    .filter(Boolean)
    .map(n => transformNode(n));

  if (pathPoints.length === 0) return;

  // Draw path segments between consecutive nodes with flowing dash animation
  ctx.setLineDash([6, 4]);
  ctx.lineDashOffset = -animTime * 20; // Flowing animation along path
  for (let i = 0; i < pathPoints.length - 1; i++) {
    drawGeodesicEdge(pathPoints[i], pathPoints[i + 1], W, H, space.color, 0.6, 2);
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  // Draw numbered markers at each path node with pulsing animation
  pathPoints.forEach((z, i) => {
    const p = toScreen(z, W, H);
    // Each marker has staggered pulse phase
    const markerPulse = 1 + 0.1 * Math.sin(animTime * 3 + i * 0.8);
    const markerR = 12 * markerPulse;

    // Circle marker
    ctx.beginPath();
    ctx.arc(p.x, p.y, markerR, 0, Math.PI * 2);
    ctx.fillStyle = `${space.color}40`;
    ctx.fill();
    ctx.strokeStyle = space.color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Number label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), p.x, p.y);
  });

  // Animate point along entire path
  if (state.pathAnimating && pathPoints.length >= 2) {
    state.pathAnimT += 0.01;
    if (state.pathAnimT > 1) state.pathAnimT = 0;

    // Map t to path segment
    const totalSegments = pathPoints.length - 1;
    const segmentT = state.pathAnimT * totalSegments;
    const segmentIdx = Math.min(Math.floor(segmentT), totalSegments - 1);
    const localT = segmentT - segmentIdx;

    const animZ = geodesicLerp(pathPoints[segmentIdx], pathPoints[segmentIdx + 1], localT);
    const animP = toScreen(animZ, W, H);

    ctx.beginPath();
    ctx.arc(animP.x, animP.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = space.color;
    ctx.shadowColor = space.color;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// Reusable render context to avoid allocations in hot path
const renderCtx = {
  graph: null,
  space: null,
  theme: null,
  focusNode: null,
  pathSet: null,  // Set for O(1) lookup instead of O(n) includes()
  breatheFactor: 1
};

function drawNodes(W, H) {
  const graph = currentGraph();
  const space = currentSpace();

  // Cache expensive lookups ONCE per frame, not per node
  renderCtx.graph = graph;
  renderCtx.space = space;
  renderCtx.theme = getThemeColors();
  renderCtx.focusNode = graph.nodes.get(state.focus);
  renderCtx.pathSet = new Set(state.pathNodes); // O(1) lookup
  renderCtx.breatheFactor = 1 + 0.03 * Math.sin(animTime * 1.05);

  // Use cached render order
  const sorted = getRenderOrder(graph);

  for (const { node } of sorted) {
    drawNodeFast(node, W, H);
  }
}

function drawNodeFast(node, W, H) {
  // Early transform and cull
  const z = transformNode(node);
  const r2 = cabs2(z);
  if (r2 > 2.5) return; // Outside visible area

  // Use cached context
  const { space, theme, focusNode, pathSet } = renderCtx;

  const p = toScreen(z, W, H);
  const isFocus = node.id === state.focus;
  const isSelected = state.selected.has(node.id);
  const isHovered = node.id === state.hovered && state.settings.features.hover;
  const isPathNode = pathSet.has(node.id); // O(1) instead of O(n)
  const isChildOfFocus = focusNode && node.parent === state.focus;

  // Size calculation (simplified)
  const baseSize = isFocus ? 16 : (isChildOfFocus ? 10 : (isSelected ? 9 : 7));
  const distScale = 1.4 - 0.9 * Math.min(1, Math.sqrt(r2));
  let size = baseSize * (1 - node.depth * 0.03) * distScale;
  if (isHovered) size *= 1.15;
  if (isChildOfFocus) size *= 1.1;
  if (isFocus) size *= renderCtx.breatheFactor; // Use pre-computed value

  // Color
  const color = state.settings.features.depthColors ? depthColor(node.depth) : space.color;

  // Glow for special nodes (skip for minimalist)
  if ((isFocus || node.pinned || isSelected || isPathNode) && theme.nodeGlow) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, size + 12, 0, Math.PI * 2);
    ctx.fillStyle = isPathNode ? `${space.color}25` :
                    node.pinned ? 'rgba(255,181,116,.2)' :
                    isFocus ? `${space.color}20` :
                    'rgba(126,231,135,.15)';
    ctx.fill();
  }

  // Hover ring
  if (isHovered) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, size + 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Node body - optimized: flat colors for regular nodes, gradients only for focus
  ctx.beginPath();
  ctx.arc(p.x, p.y, size, 0, Math.PI * 2);

  const isMinimalist = state.settings.theme === 'minimalist';

  // Only create expensive gradients for the focused node
  if (isFocus && !isMinimalist) {
    const grad = ctx.createRadialGradient(p.x - size/3, p.y - size/3, 0, p.x, p.y, size);
    grad.addColorStop(0, lightenColor(space.color, 30));
    grad.addColorStop(1, space.color);
    ctx.fillStyle = grad;
    ctx.shadowColor = space.color;
    ctx.shadowBlur = 15;
  } else {
    // Flat colors for all other nodes (much faster)
    ctx.fillStyle = isFocus ? space.color :
                    node.pinned ? (isMinimalist ? '#606060' : '#ffb574') :
                    isPathNode ? (isMinimalist ? '#404040' : space.color) :
                    isMinimalist ? `rgb(${Math.max(60, 160 - node.depth * 15)},${Math.max(60, 160 - node.depth * 15)},${Math.max(60, 160 - node.depth * 15)})` :
                    color;
    ctx.shadowBlur = 0;
  }

  ctx.fill();
  ctx.shadowBlur = 0;

  // Border
  if (isMinimalist) {
    ctx.strokeStyle = isFocus ? '#303030' :
                      isSelected ? '#404040' :
                      isPathNode ? '#505050' :
                      '#909090';
    ctx.lineWidth = isFocus ? 2 : 1.5;
  } else {
    ctx.strokeStyle = isFocus ? `${space.color}80` :
                      isSelected ? 'rgba(126,231,135,.5)' :
                      isPathNode ? `${space.color}60` :
                      'rgba(255,255,255,.1)';
    ctx.lineWidth = isFocus ? 2 : 1;
  }
  ctx.stroke();

  // Action indicator (lightning bolt for executable nodes)
  if (node.action && typeof node.action === 'function') {
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = '#ffd666';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('⚡', p.x, p.y);
    ctx.textAlign = 'left'; // Reset
  }

  // Infrastructure status indicator (colored health dot)
  if (state.currentSpace === 'infra' && state.settings.overlays.observables && node.tags && node.tags.length > 0) {
    const obsStatus = getNodeObservableStatus(node);
    if (obsStatus && obsStatus.status !== 'unknown') {
      // Draw status dot
      const dotRadius = Math.max(3, size * 0.35);
      const dotX = p.x + size * 0.7;
      const dotY = p.y - size * 0.7;

      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = obsStatus.color;
      ctx.fill();

      // Pulse animation for recent changes
      if (obsStatus.recentChange) {
        const pulsePhase = (Date.now() % 1000) / 1000;
        const pulseRadius = dotRadius + 4 * Math.sin(pulsePhase * Math.PI * 2);
        ctx.beginPath();
        ctx.arc(dotX, dotY, pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = obsStatus.color + '60';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // Label
  let labelY = p.y;
  if (state.settings.features.labels && (r2 < 0.35 || isFocus || node.pinned || isHovered || isPathNode)) {
    const alpha = Math.max(0.4, 0.95 - r2 * 0.5);
    ctx.font = `${isFocus ? '600 ' : ''}11px -apple-system, BlinkMacSystemFont, sans-serif`;
    // Theme-aware label color
    const labelBase = state.settings.theme === 'minimalist' ? '26,26,26' :
                      state.settings.theme === 'skeuomorphic' ? '245,232,216' : '255,255,255';
    ctx.fillStyle = `rgba(${labelBase},${alpha})`;
    ctx.textBaseline = 'middle';
    ctx.fillText(node.name, p.x + size + 7, p.y);
    labelY = p.y + 14;
  }

  // Content display on canvas when zoomed in, focused, or hovered
  const showContent = state.settings.features.showContent && node.content && node.content.length > 0 &&
                      (isFocus || (isHovered && r2 < 0.2) || (r2 < 0.08 && state.zoom > 1.5));
  if (showContent) {
    const contentAlpha = isFocus ? 0.85 : (isHovered ? 0.75 : Math.max(0.3, 0.7 - r2 * 3));
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = `rgba(200,200,200,${contentAlpha})`;
    ctx.textBaseline = 'top';

    // Wrap and truncate content
    const maxWidth = 150;
    const maxLines = isFocus ? 4 : 2;
    const words = node.content.split(' ');
    let lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
        if (lines.length >= maxLines) break;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine && lines.length < maxLines) {
      lines.push(currentLine);
    }
    if (lines.length >= maxLines && currentLine !== lines[lines.length - 1]) {
      lines[lines.length - 1] = lines[lines.length - 1].slice(0, -3) + '...';
    }

    // Draw content background
    const lineHeight = 13;
    const padding = 4;
    const contentWidth = Math.max(...lines.map(l => ctx.measureText(l).width)) + padding * 2;
    const contentHeight = lines.length * lineHeight + padding * 2;
    const contentX = p.x + size + 5;
    const contentY = labelY + 2;

    ctx.fillStyle = `rgba(20,20,25,${contentAlpha * 0.9})`;
    ctx.fillRect(contentX, contentY, contentWidth, contentHeight);

    // Draw content text
    ctx.fillStyle = `rgba(180,180,190,${contentAlpha})`;
    lines.forEach((line, i) => {
      ctx.fillText(line, contentX + padding, contentY + padding + i * lineHeight);
    });
  }
}

function lightenColor(hex, amt) {
  if (!hex.startsWith('#')) return hex;
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + amt);
  const g = Math.min(255, ((num >> 8) & 0xff) + amt);
  const b = Math.min(255, (num & 0xff) + amt);
  return `rgb(${r},${g},${b})`;
}

// ════════════════════════════════════════════════════════════════════════════
// GEOMETRIC OVERLAYS (P1/P3 Extensions)
// ════════════════════════════════════════════════════════════════════════════

function drawVoronoiOverlay(W, H) {
  if (!state.settings.overlays.voronoi || !window.GeometryExtensions) return;

  const graph = currentGraph();
  const space = currentSpace();
  const { hyperbolicVoronoiDiagram } = window.GeometryExtensions;

  // Collect visible node positions
  const points = [];
  const nodeList = [];
  for (const node of graph.nodes.values()) {
    if (node.hidden) continue;
    const z = transformNode(node);
    if (cabs(z) < 0.95) {
      points.push(z);
      nodeList.push(node);
    }
  }

  if (points.length < 3) return;

  // Compute Voronoi diagram
  const cells = hyperbolicVoronoiDiagram(points, Math.min(8, points.length - 1));

  ctx.strokeStyle = `${space.color}25`;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  cells.forEach((cellVertices, idx) => {
    if (cellVertices.length < 3) return;

    ctx.beginPath();
    const first = toScreen(cellVertices[0], W, H);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < cellVertices.length; i++) {
      const p = toScreen(cellVertices[i], W, H);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();

    // Optional: fill with node's depth color at low alpha
    if (nodeList[idx]) {
      ctx.fillStyle = `${depthColor(nodeList[idx].depth)}08`;
      ctx.fill();
    }
  });

  ctx.setLineDash([]);
}

// Tiling cache for performance
let tilingCache = { p: 0, q: 0, edges: null };

function drawTilingOverlay(W, H) {
  if (!state.settings.overlays.tiling || !window.GeometryExtensions) return;

  const { generateTiling } = window.GeometryExtensions;
  const space = currentSpace();
  const [p, q] = state.settings.overlays.tilingPQ || [7, 3];

  // Use cached tiling if parameters haven't changed
  if (tilingCache.p !== p || tilingCache.q !== q || !tilingCache.edges) {
    tilingCache.p = p;
    tilingCache.q = q;
    tilingCache.edges = generateTiling(p, q, 3);
  }
  const edges = tilingCache.edges;

  ctx.strokeStyle = `${space.color}18`;
  ctx.lineWidth = 0.5;

  for (const edge of edges) {
    // Transform through camera
    const z1 = mobius(state.camera, edge.start);
    const z2 = mobius(state.camera, edge.end);

    // Cull edges outside view
    if (cabs(z1) > 1.5 && cabs(z2) > 1.5) continue;

    // Draw as geodesic arc
    drawGeodesicEdge(z1, z2, W, H, space.color, 0.15, 0.5);
  }
}

function drawTransportOverlay(W, H) {
  if (!state.settings.overlays.transport || !window.GeometryExtensions) return;

  const graph = currentGraph();
  const space = currentSpace();
  const { transportField } = window.GeometryExtensions;

  // If we have a path, show parallel transport along it
  if (state.pathNodes.length >= 2) {
    const startNode = graph.nodes.get(state.pathNodes[0]);
    const endNode = graph.nodes.get(state.pathNodes[state.pathNodes.length - 1]);
    if (!startNode || !endNode) return;

    const z1 = transformNode(startNode);
    const z2 = transformNode(endNode);

    // Transport a reference vector along the geodesic
    const startVector = cpolar(0.1, Math.PI / 4);
    const field = transportField(startVector, z1, z2, 12);

    ctx.strokeStyle = `${space.color}60`;
    ctx.lineWidth = 1.5;

    for (const { point, vector } of field) {
      const p = toScreen(point, W, H);
      const { R } = getDiskParams(W, H);

      // Scale vector for display
      const vScale = R * 0.15 * state.zoom;
      const vx = vector.re * vScale;
      const vy = vector.im * vScale;

      // Draw vector arrow
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + vx, p.y + vy);
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(vy, vx);
      const headLen = 6;
      ctx.beginPath();
      ctx.moveTo(p.x + vx, p.y + vy);
      ctx.lineTo(
        p.x + vx - headLen * Math.cos(angle - 0.4),
        p.y + vy - headLen * Math.sin(angle - 0.4)
      );
      ctx.moveTo(p.x + vx, p.y + vy);
      ctx.lineTo(
        p.x + vx - headLen * Math.cos(angle + 0.4),
        p.y + vy - headLen * Math.sin(angle + 0.4)
      );
      ctx.stroke();
    }
  }
}

/**
 * Draw hypercycles overlay.
 * Shows curves equidistant from geodesic edges.
 * Optimized: only draws edges near focus, limited count.
 */
function drawHypercyclesOverlay(W, H) {
  if (!state.settings.overlays.hypercycles) return;

  const graph = currentGraph();
  const space = currentSpace();
  const focusNode = graph.nodes.get(state.focus);
  if (!focusNode) return;

  const fz = transformNode(focusNode);

  ctx.strokeStyle = `${space.color}30`;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  // Only draw hypercycles for edges near focus (performance)
  let count = 0;
  const MAX_HYPERCYCLES = 8;

  for (const node of graph.nodes.values()) {
    if (count >= MAX_HYPERCYCLES) break;
    if (node.hidden || node.parent < 0) continue;
    const parent = graph.nodes.get(node.parent);
    if (!parent || parent.hidden) continue;

    const z1 = transformNode(parent);
    const z2 = transformNode(node);

    // Skip if edge not near focus or outside view
    const edgeDist = Math.min(hypDist(fz, z1), hypDist(fz, z2));
    if (edgeDist > 2 || (cabs(z1) > 1 && cabs(z2) > 1)) continue;

    count++;

    // Draw single hypercycle at fixed distance
    const points = hypercycle(z1, z2, 0.2, 16);
    if (points.length < 2) continue;

    ctx.beginPath();
    const first = toScreen(points[0], W, H);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i++) {
      const p = toScreen(points[i], W, H);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  ctx.setLineDash([]);
}

/**
 * Draw horocycles overlay.
 * Shows horocycles at the boundary for ideal points of visible geodesics.
 */
function drawHorocyclesOverlay(W, H) {
  if (!state.settings.overlays.horocycles) return;

  const graph = currentGraph();
  const space = currentSpace();
  const { cx, cy, R } = getDiskParams(W, H);

  ctx.strokeStyle = `${space.color}25`;
  ctx.lineWidth = 1;

  // Draw horocycles for focused node's geodesics
  const focusNode = graph.nodes.get(state.focus);
  if (!focusNode) return;

  const fz = transformNode(focusNode);
  const children = [...graph.nodes.values()].filter(n =>
    n.parent === state.focus && !n.hidden
  );

  for (const child of children.slice(0, 5)) { // Limit for performance
    const cz = transformNode(child);
    const ideals = idealEndpoints(fz, cz);

    for (const ideal of ideals) {
      // Draw horocycle tangent to this ideal point
      const points = horocycle(ideal, 0.15, 32);
      if (points.length < 3) continue;

      ctx.beginPath();
      const first = toScreen(points[0], W, H);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < points.length; i++) {
        const p = toScreen(points[i], W, H);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

/**
 * Draw ideal points overlay.
 * Shows where geodesics meet the boundary at infinity.
 */
function drawIdealPointsOverlay(W, H) {
  if (!state.settings.overlays.idealPoints) return;

  const graph = currentGraph();
  const space = currentSpace();
  const { cx, cy, R } = getDiskParams(W, H);

  // Highlight ideal endpoints of edges from focus
  const focusNode = graph.nodes.get(state.focus);
  if (!focusNode) return;

  const fz = transformNode(focusNode);
  const connections = [...graph.nodes.values()].filter(n =>
    (n.parent === state.focus || n.id === focusNode.parent) && !n.hidden
  );

  ctx.fillStyle = space.color;
  ctx.strokeStyle = `${space.color}60`;
  ctx.lineWidth = 1;

  const seenAngles = new Set();

  for (const conn of connections.slice(0, 8)) {
    const cz = transformNode(conn);
    const ideals = idealEndpoints(fz, cz);

    for (const ideal of ideals) {
      const angle = Math.round(carg(ideal) * 10); // Discretize to avoid overlaps
      if (seenAngles.has(angle)) continue;
      seenAngles.add(angle);

      // Draw small marker at boundary
      const px = cx + ideal.re * R * 1.02;
      const py = cy + ideal.im * R * 1.02;

      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();

      // Draw ray from focus toward ideal point
      ctx.beginPath();
      const fp = toScreen(fz, W, H);
      ctx.moveTo(fp.x, fp.y);
      ctx.lineTo(px, py);
      ctx.setLineDash([2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/**
 * Draw circumcircles overlay.
 * Shows hyperbolic circumcircles of triangles formed by node triplets.
 */
function drawCircumcirclesOverlay(W, H) {
  if (!state.settings.overlays.circumcircles) return;

  const graph = currentGraph();
  const space = currentSpace();

  // Get visible nodes near focus
  const focusNode = graph.nodes.get(state.focus);
  if (!focusNode) return;

  const fz = transformNode(focusNode);
  const nearby = [...graph.nodes.values()]
    .filter(n => !n.hidden && n.id !== state.focus)
    .map(n => ({ node: n, z: transformNode(n), dist: hypDist(fz, transformNode(n)) }))
    .filter(item => item.dist < 2)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 6);

  if (nearby.length < 2) return;

  ctx.strokeStyle = `${space.color}30`;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  // Draw circumcircles for triangles with focus
  for (let i = 0; i < nearby.length; i++) {
    for (let j = i + 1; j < nearby.length; j++) {
      const cc = hypCircumcenter(fz, nearby[i].z, nearby[j].z);
      if (!cc || cabs(cc) > 0.95) continue;

      // Compute circumradius
      const r = hypDist(cc, fz);
      if (r > 3) continue; // Skip huge circles

      // Draw the circle
      const points = hypCircle(cc, r, 48);
      if (points.length < 3) continue;

      ctx.beginPath();
      const first = toScreen(points[0], W, H);
      ctx.moveTo(first.x, first.y);
      for (let k = 1; k < points.length; k++) {
        const p = toScreen(points[k], W, H);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  ctx.setLineDash([]);
}

/**
 * Draw the selection rectangle when in select mode and dragging.
 */
function drawSelectionRect(W, H) {
  if (!state.selectionRect) return;

  const r = state.selectionRect;
  const x = Math.min(r.x1, r.x2);
  const y = Math.min(r.y1, r.y2);
  const w = Math.abs(r.x2 - r.x1);
  const h = Math.abs(r.y2 - r.y1);

  const space = currentSpace();

  // Fill with translucent space color
  ctx.fillStyle = `${space.color}15`;
  ctx.fillRect(x, y, w, h);

  // Stroke with solid space color
  ctx.strokeStyle = `${space.color}80`;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Show selection count
  const count = state.selected.size;
  if (count > 0) {
    ctx.fillStyle = space.color;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`${count} selected`, x + 4, y - 4);
  }
}

function renderMinimap() {
  if (!miniCtx) return;
  const W = 100, H = 80, R = 35;
  const cx = W / 2, cy = H / 2;
  const space = currentSpace();

  miniCtx.clearRect(0, 0, W, H);

  // Disk boundary
  miniCtx.beginPath();
  miniCtx.arc(cx, cy, R, 0, Math.PI * 2);
  miniCtx.strokeStyle = miniDragging ? space.color : `${space.color}40`;
  miniCtx.lineWidth = miniDragging ? 2 : 1;
  miniCtx.stroke();

  // Nodes
  const graph = currentGraph();
  for (const node of graph.nodes.values()) {
    if (node.hidden) continue;
    const z = transformNode(node);
    if (cabs(z) > 1.2) continue;

    const x = cx + z.re * R;
    const y = cy + z.im * R;
    const isFocus = node.id === state.focus;
    const isSelected = state.selected.has(node.id);

    miniCtx.beginPath();
    miniCtx.arc(x, y, isFocus ? 4 : isSelected ? 3 : 2, 0, Math.PI * 2);
    miniCtx.fillStyle = isFocus ? space.color :
                        node.pinned ? '#ffb574' :
                        isSelected ? `${space.color}90` :
                        'rgba(255,255,255,.4)';
    miniCtx.fill();
  }

  // Viewport indicator (current view) with rotating dash animation
  const viewR = R / state.zoom * 0.7;
  miniCtx.beginPath();
  miniCtx.arc(cx, cy, Math.min(viewR, R), 0, Math.PI * 2);
  miniCtx.strokeStyle = `${space.color}50`;
  miniCtx.setLineDash([3, 3]);
  miniCtx.lineDashOffset = -animTime * 8; // Rotating dash animation
  miniCtx.stroke();
  miniCtx.setLineDash([]);
  miniCtx.lineDashOffset = 0;

  // Target indicator (where camera is moving to, if different)
  const targetDist = cabs(csub(state.camera, state.targetCamera));
  if (targetDist > 0.01 || miniDragging) {
    // Show target position
    const tz = mobius(state.camera, state.targetCamera);
    const tx = cx + tz.re * R;
    const ty = cy + tz.im * R;

    // Crosshair at target
    miniCtx.strokeStyle = space.color;
    miniCtx.lineWidth = 1.5;
    miniCtx.beginPath();
    miniCtx.moveTo(tx - 6, ty);
    miniCtx.lineTo(tx + 6, ty);
    miniCtx.moveTo(tx, ty - 6);
    miniCtx.lineTo(tx, ty + 6);
    miniCtx.stroke();
  }
}

/**
 * Convert Poincaré disk point to Klein disk projection.
 * Klein disk maps: z -> 2z / (1 + |z|²)
 * In Klein model, geodesics are straight lines (Euclidean chords).
 */
function poincareToKlein(z) {
  const r2 = cabs2(z);
  const denom = 1 + r2;
  return { re: 2 * z.re / denom, im: 2 * z.im / denom };
}

/**
 * Render the Klein disk minimap.
 * In Klein disk: geodesics are straight lines, but angles are distorted.
 */
function renderKleinMinimap() {
  if (!kleinCtx) return;

  const W = 100, H = 80, R = 35;
  const cx = W / 2, cy = H / 2;
  const space = currentSpace();
  const graph = currentGraph();

  kleinCtx.clearRect(0, 0, W, H);

  // Disk boundary (unit circle in Klein model)
  kleinCtx.beginPath();
  kleinCtx.arc(cx, cy, R, 0, Math.PI * 2);
  kleinCtx.strokeStyle = `${space.color}40`;
  kleinCtx.lineWidth = 1;
  kleinCtx.stroke();

  // Draw edges first (straight lines in Klein model - this is the key feature!)
  kleinCtx.strokeStyle = 'rgba(255,255,255,0.15)';
  kleinCtx.lineWidth = 0.5;
  for (const node of graph.nodes.values()) {
    if (node.hidden || !node.parent) continue;
    const parent = graph.nodes.get(node.parent);
    if (!parent || parent.hidden) continue;

    // Transform both endpoints to Poincaré, then to Klein
    const zChild = transformNode(node);
    const zParent = transformNode(parent);
    if (cabs(zChild) > 1.2 || cabs(zParent) > 1.2) continue;

    const kChild = poincareToKlein(zChild);
    const kParent = poincareToKlein(zParent);

    kleinCtx.beginPath();
    kleinCtx.moveTo(cx + kParent.re * R, cy + kParent.im * R);
    kleinCtx.lineTo(cx + kChild.re * R, cy + kChild.im * R);
    kleinCtx.stroke();
  }

  // Draw nodes
  for (const node of graph.nodes.values()) {
    if (node.hidden) continue;
    const z = transformNode(node);
    if (cabs(z) > 1.2) continue;

    // Convert to Klein coordinates
    const k = poincareToKlein(z);
    const x = cx + k.re * R;
    const y = cy + k.im * R;
    const isFocus = node.id === state.focus;
    const isSelected = state.selected.has(node.id);

    kleinCtx.beginPath();
    kleinCtx.arc(x, y, isFocus ? 3 : isSelected ? 2.5 : 1.5, 0, Math.PI * 2);
    kleinCtx.fillStyle = isFocus ? space.color :
                         node.pinned ? '#ffb574' :
                         isSelected ? `${space.color}90` :
                         'rgba(255,255,255,.35)';
    kleinCtx.fill();
  }

  // Viewport indicator (approximate, since Klein distorts differently) with rotating dash
  const viewR = R / state.zoom * 0.6;
  kleinCtx.beginPath();
  kleinCtx.arc(cx, cy, Math.min(viewR, R), 0, Math.PI * 2);
  kleinCtx.strokeStyle = `${space.color}40`;
  kleinCtx.setLineDash([2, 2]);
  kleinCtx.lineDashOffset = -animTime * 6; // Slightly different rotation speed
  kleinCtx.stroke();
  kleinCtx.setLineDash([]);
  kleinCtx.lineDashOffset = 0;
}

/**
 * Update the coordinates display panel.
 */
function updateCoordsDisplay() {
  const coordCamera = document.getElementById('coordCamera');
  const coordDist = document.getElementById('coordDist');
  const coordZoom = document.getElementById('coordZoom');
  const coordNodes = document.getElementById('coordNodes');

  if (!coordCamera) return;

  // Camera position in disk (show as coordinates)
  const camR = cabs(state.camera);
  coordCamera.textContent = `${state.camera.re.toFixed(2)}, ${state.camera.im.toFixed(2)}`;

  // Hyperbolic distance from origin
  const hypDistVal = 2 * Math.atanh(Math.min(camR, 0.9999));
  if (coordDist) coordDist.textContent = hypDistVal.toFixed(2);

  // Zoom level
  if (coordZoom) coordZoom.textContent = `${state.zoom.toFixed(2)}x`;

  // Visible nodes count
  const graph = currentGraph();
  let visibleCount = 0;
  for (const node of graph.nodes.values()) {
    if (!node.hidden) {
      const z = transformNode(node);
      if (cabs(z) < 1.1) visibleCount++;
    }
  }
  if (coordNodes) coordNodes.textContent = `${visibleCount}/${graph.nodes.size}`;
}

/**
 * Render tree layout minimap.
 * Shows hierarchical structure as a simple tree.
 */
function renderTreeMinimap() {
  if (!treeCtx) return;

  const W = 100, H = 80;
  const graph = currentGraph();
  const space = currentSpace();

  treeCtx.fillStyle = '#1a1a1a';
  treeCtx.fillRect(0, 0, W, H);

  // Draw boundary
  treeCtx.strokeStyle = '#333';
  treeCtx.lineWidth = 1;
  treeCtx.strokeRect(1, 1, W - 2, H - 2);

  if (graph.nodes.size === 0) return;

  // Get depth of each node
  const depths = new Map();
  const maxDepth = { val: 0 };
  const countAtDepth = new Map();

  for (const node of graph.nodes.values()) {
    if (node.hidden) continue;
    const d = node.depth || 0;
    depths.set(node.id, d);
    maxDepth.val = Math.max(maxDepth.val, d);
    countAtDepth.set(d, (countAtDepth.get(d) || 0) + 1);
  }

  // Simple tree layout: x = depth, y = index at depth
  const indexAtDepth = new Map();
  for (const node of graph.nodes.values()) {
    if (node.hidden) continue;
    const d = depths.get(node.id);
    const idx = indexAtDepth.get(d) || 0;
    indexAtDepth.set(d, idx + 1);

    const count = countAtDepth.get(d) || 1;
    const x = 10 + (d / Math.max(1, maxDepth.val)) * (W - 20);
    const y = 10 + ((idx + 0.5) / count) * (H - 20);

    // Draw node
    const isFocus = node.id === state.focus;
    const r = isFocus ? 4 : 2;
    treeCtx.beginPath();
    treeCtx.arc(x, y, r, 0, Math.PI * 2);
    treeCtx.fillStyle = isFocus ? space.color : 'rgba(255,255,255,0.5)';
    treeCtx.fill();
  }
}

/**
 * Render upper half-plane minimap.
 * In half-plane model: geodesics are vertical lines or semicircles on x-axis.
 */
function renderHalfplaneMinimap() {
  // Use klein canvas for half-plane (repurpose based on what's visible)
  if (!kleinCtx) return;

  const W = 100, H = 80;
  const space = currentSpace();
  const graph = currentGraph();

  kleinCtx.clearRect(0, 0, W, H);

  // Background
  kleinCtx.fillStyle = '#0a0a0f';
  kleinCtx.fillRect(0, 0, W, H);

  // Boundary line (x-axis = infinity)
  kleinCtx.beginPath();
  kleinCtx.moveTo(0, H - 5);
  kleinCtx.lineTo(W, H - 5);
  kleinCtx.strokeStyle = `${space.color}60`;
  kleinCtx.lineWidth = 2;
  kleinCtx.stroke();

  // Convert Poincaré points to half-plane and draw
  const HP = window.HyperbolicProjections ? window.HyperbolicProjections.UpperHalfPlane : null;
  if (!HP) return;

  // Scaling for half-plane view
  const scale = 25;
  const offsetX = W / 2;
  const offsetY = H - 10;

  for (const node of graph.nodes.values()) {
    if (node.hidden) continue;
    const z = transformNode(node);
    if (cabs(z) > 0.99) continue;

    // Convert to half-plane
    const hp = HP.fromPoincare(z);
    if (!hp || hp.im <= 0) continue;

    // Map to minimap coordinates
    const x = offsetX + hp.re * scale;
    const y = offsetY - Math.log1p(hp.im) * scale; // Log scale for y

    if (y < 0 || y > H - 5) continue;

    const isFocus = node.id === state.focus;
    const isSelected = state.selected.has(node.id);

    kleinCtx.beginPath();
    kleinCtx.arc(x, y, isFocus ? 3 : isSelected ? 2.5 : 1.5, 0, Math.PI * 2);
    kleinCtx.fillStyle = isFocus ? space.color :
                         node.pinned ? '#ffb574' :
                         isSelected ? `${space.color}90` :
                         'rgba(255,255,255,.35)';
    kleinCtx.fill();
  }
}

/**
 * Render all minimaps based on settings.
 */
function renderAllMinimaps() {
  if (state.settings.minimaps.poincare) renderMinimap();
  if (state.settings.minimaps.klein && !state.settings.minimaps.halfplane) renderKleinMinimap();
  if (state.settings.minimaps.halfplane) renderHalfplaneMinimap();
  if (state.settings.minimaps.tree) renderTreeMinimap();
  if (state.settings.hud.coords) updateCoordsDisplay();
}

// ════════════════════════════════════════════════════════════════════════════
// PHYSICS & ANIMATION
// ════════════════════════════════════════════════════════════════════════════

function updatePhysics() {
  // Skip smooth animations during active canvas dragging to prevent jitter
  const isActiveDrag = state.dragging && !state.draggingNode;

  // Momentum (only when not dragging)
  if (!state.dragging && state.settings.features.momentum && cabs(state.velocity) > 0.0001) {
    const step = cscale(state.velocity, 0.016);
    state.camera = clampDisk(mobiusInv(step, state.camera));
    state.velocity = cscale(state.velocity, state.friction);
  }

  // Smooth camera transition (skip during active canvas drag)
  if (!isActiveDrag && state.settings.features.animations && cabs(csub(state.camera, state.targetCamera)) > 0.001) {
    state.camera = geodesicLerp(state.camera, state.targetCamera, 0.12);
  }

  // Smooth zoom (use faster interpolation during wheel scroll for responsiveness)
  if (Math.abs(state.zoom - state.targetZoom) > 0.001) {
    const zoomSpeed = state.dragging ? 0.25 : 0.15;
    state.zoom += (state.targetZoom - state.zoom) * zoomSpeed;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HIT TESTING
// ════════════════════════════════════════════════════════════════════════════

// Cache for hit testing optimization
let hitTestCache = {
  positions: null,       // Array of {node, p} for visible nodes
  timestamp: 0,          // When cache was built
  cameraRe: 0,           // Camera position when cache was built
  cameraIm: 0,
  zoom: 1
};

const HIT_TEST_CACHE_TTL = 100; // ms - rebuild cache after this time
const HIT_THRESHOLD = 400;      // Squared pixel distance for hit

/**
 * Optimized hit test using cached screen positions.
 * Rebuilds cache only when view changes significantly or cache expires.
 */
function hitTest(x, y) {
  const rect = canvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  const graph = currentGraph();

  if (!graph || !graph.nodes) return null;

  const now = performance.now();

  // Check if cache is valid
  const cacheValid = hitTestCache.positions &&
    (now - hitTestCache.timestamp < HIT_TEST_CACHE_TTL) &&
    Math.abs(hitTestCache.cameraRe - state.camera.re) < 0.001 &&
    Math.abs(hitTestCache.cameraIm - state.camera.im) < 0.001 &&
    Math.abs(hitTestCache.zoom - state.zoom) < 0.01;

  // Rebuild cache if needed
  if (!cacheValid) {
    hitTestCache.positions = [];
    hitTestCache.timestamp = now;
    hitTestCache.cameraRe = state.camera.re;
    hitTestCache.cameraIm = state.camera.im;
    hitTestCache.zoom = state.zoom;

    // Pre-compute screen positions for all visible nodes
    for (const node of graph.nodes.values()) {
      if (node.hidden) continue;

      // Early culling: skip nodes far from view center
      const z = transformNode(node);
      if (!isValidComplex(z) || cabs2(z) > 2.5) continue;

      const p = nodeScreenPos(node, W, H);
      if (p.x >= -50 && p.x <= W + 50 && p.y >= -50 && p.y <= H + 50) {
        hitTestCache.positions.push({ node, p });
      }
    }
  }

  // Find closest node from cache
  let closest = null;
  let closestD2 = Infinity;

  for (const { node, p } of hitTestCache.positions) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;

    // Early exit if we find a very close node
    if (d2 < 25) { // Within 5 pixels - definitely the target
      return node;
    }

    if (d2 < closestD2) {
      closestD2 = d2;
      closest = node;
    }
  }

  return closestD2 < HIT_THRESHOLD ? closest : null;
}

// Invalidate hit test cache (call when graph changes)
function invalidateHitTestCache() {
  hitTestCache.timestamp = 0;
}

// ════════════════════════════════════════════════════════════════════════════
// INTERACTION HANDLERS (with throttling for performance)
// ════════════════════════════════════════════════════════════════════════════

// Throttle utility for event handlers
let lastHoverCheck = 0;
const HOVER_THROTTLE_MS = 16; // ~60fps for hover detection

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);

  // Check if clicking on a node (for potential node dragging)
  const hit = hitTest(e.offsetX, e.offsetY);

  state.dragging = true;
  state.dragStart = { x: e.offsetX, y: e.offsetY };
  state.lastPointer = { x: e.offsetX, y: e.offsetY };
  state.lastTime = performance.now();
  state.velocity = C(0, 0);

  // If in pan mode and clicked on a node, prepare for node dragging
  if (state.mode === 'pan' && hit && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    state.draggingNode = hit.id;
    state.dragNodeStartZ = { re: hit.z.re, im: hit.z.im };
    mainEl.classList.add('dragging-node');
  } else {
    state.draggingNode = null;
    state.dragNodeStartZ = null;
  }

  // In select mode, start selection rectangle
  if (state.mode === 'select' && !hit) {
    state.selectionRect = {
      x1: e.offsetX, y1: e.offsetY,
      x2: e.offsetX, y2: e.offsetY
    };
  } else {
    state.selectionRect = null;
  }

  mainEl.classList.add('dragging');
});

canvas.addEventListener('pointermove', e => {
  const now = performance.now();

  // Throttle hover detection when not dragging
  if (!state.dragging) {
    if (now - lastHoverCheck < HOVER_THROTTLE_MS) return;
    lastHoverCheck = now;
  }

  const hit = hitTest(e.offsetX, e.offsetY);
  const wasHovered = state.hovered;
  state.hovered = hit ? hit.id : null;

  // Only update DOM if hover state changed
  if (wasHovered !== state.hovered) {
    mainEl.classList.toggle('hover-node', state.hovered !== null);
  }

  if (hit && state.settings.features.hover) {
    showTooltip(hit, e.clientX, e.clientY);
  } else if (wasHovered !== state.hovered) {
    hideTooltip();
  }

  if (!state.dragging) return;

  const rect = canvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  const currentPointer = { x: e.offsetX, y: e.offsetY };
  const dt = Math.max(1, performance.now() - state.lastTime) / 1000;

  if (state.mode === 'pan') {
    // Check if we're dragging a node
    if (state.draggingNode) {
      // Node dragging: move node in hyperbolic space
      const graph = currentGraph();
      const node = graph.nodes.get(state.draggingNode);
      if (node) {
        // Convert screen position to hyperbolic coordinates (world space)
        const screenZ = fromScreen(currentPointer.x, currentPointer.y, W, H);
        // Transform from view space to world space
        const worldZ = mobiusInv(state.camera, screenZ);
        // Clamp to disk with margin
        node.z = clampDisk(worldZ, 0.02);
        // Invalidate caches
        invalidateRenderCache();
      }
    } else {
      // Camera panning
      const z0 = fromScreen(state.lastPointer.x, state.lastPointer.y, W, H);
      const z1 = fromScreen(currentPointer.x, currentPointer.y, W, H);
      const delta = csub(z0, z1);
      const scaleFactor = 0.75 / Math.max(0.3, state.zoom);
      const step = clampDisk(cscale(delta, scaleFactor));

      state.camera = clampDisk(mobiusInv(step, state.camera));
      state.targetCamera = state.camera;
      state.velocity = cscale(delta, scaleFactor / dt * 0.3);
    }
  }

  // Update selection rectangle in select mode
  if (state.mode === 'select' && state.selectionRect) {
    state.selectionRect.x2 = currentPointer.x;
    state.selectionRect.y2 = currentPointer.y;

    // Find all nodes inside the selection rectangle
    const graph = currentGraph();
    const r = state.selectionRect;
    const minX = Math.min(r.x1, r.x2);
    const maxX = Math.max(r.x1, r.x2);
    const minY = Math.min(r.y1, r.y2);
    const maxY = Math.max(r.y1, r.y2);

    // Clear and rebuild selection
    state.selected.clear();
    for (const node of graph.nodes.values()) {
      if (node.hidden) continue;
      const p = nodeScreenPos(node, W, H);
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
        state.selected.add(node.id);
      }
    }
    updateSelectionBadge();
  }

  state.lastPointer = currentPointer;
  state.lastTime = performance.now();
});

canvas.addEventListener('pointerup', () => {
  // If we were dragging a node, save the graph state
  if (state.draggingNode) {
    saveToHistory();
    mainEl.classList.remove('dragging-node');
  }

  // Clear selection rectangle
  state.selectionRect = null;

  state.dragging = false;
  state.draggingNode = null;
  state.dragNodeStartZ = null;
  mainEl.classList.remove('dragging');
});

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  const hit = hitTest(e.offsetX, e.offsetY);

  if (!hit) {
    // Click on empty space
    if (state.mode === 'select') {
      state.selected.clear();
      state.selected.add(state.focus);
      updateSelectionBadge();
    } else if (state.mode === 'path' && state.pathNodes.length > 0) {
      // In path mode with nodes - Escape-like behavior: clear path
      // (but only if shift not held - shift+click on empty creates node)
    }
    return;
  }

  if (e.shiftKey) {
    // Shift+click: Toggle pin
    hit.pinned = !hit.pinned;
    updatePanel();
    updateBookmarks();
    return;
  }

  if (e.metaKey || e.ctrlKey) {
    // Ctrl/Cmd+click: Add to multi-select
    if (state.selected.has(hit.id)) {
      state.selected.delete(hit.id);
    } else {
      state.selected.add(hit.id);
    }
    updateSelectionBadge();
    return;
  }

  if (e.altKey) {
    // Alt+click: Add to path (multi-point path tracing)
    if (!state.pathNodes.includes(hit.id)) {
      state.pathNodes.push(hit.id);
      state.selected.add(hit.id);
      updatePathBadge();
      updateSelectionBadge();
    }
    return;
  }

  if (state.mode === 'path') {
    // Path mode: clicking adds nodes to path sequence
    if (!state.pathNodes.includes(hit.id)) {
      state.pathNodes.push(hit.id);
      state.selected.add(hit.id);
    } else {
      // Clicking existing path node - remove it and all after it
      const idx = state.pathNodes.indexOf(hit.id);
      state.pathNodes = state.pathNodes.slice(0, idx);
    }
    updatePathBadge();
    updateSelectionBadge();
    // Don't change focus in path mode - just track the path
    return;
  }

  if (state.mode === 'link') {
    // Link mode: create link from linkDragFrom to clicked node
    if (state.linkDragFrom && state.linkDragFrom !== hit.id) {
      linkNodes(state.linkDragFrom, hit.id);
      showToast(`Linked to ${hit.name}`);
    }
    state.linkDragFrom = null;
    state.mode = 'nav';
    if (typeof updateModeIndicator === 'function') updateModeIndicator();
    return;
  }

  if (state.mode === 'reparent') {
    // Reparent mode: move editingNode under clicked node
    if (state.editingNode && state.editingNode !== hit.id) {
      reparentNode(state.editingNode, hit.id);
      showToast(`Moved under ${hit.name}`);
    }
    state.editingNode = null;
    state.mode = 'nav';
    if (typeof updateModeIndicator === 'function') updateModeIndicator();
    return;
  }

  // Default: Focus the node (with semantic zoom)
  focusNode(hit.id);
});

canvas.addEventListener('dblclick', e => {
  const rect = canvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  const hit = hitTest(e.offsetX, e.offsetY);

  if (hit) {
    // Double-click on node: focus and zoom in
    focusNode(hit.id);
    state.targetZoom = Math.min(2.5, state.zoom * 1.5);

    // If node has an action, execute it
    if (hit.action && typeof hit.action === 'function') {
      hit.action(hit, currentGraph());
    }
  } else {
    // Double-click on empty space: create new node
    const z = fromScreen(e.offsetX, e.offsetY, W, H);
    const worldZ = mobiusInv(state.camera, z); // Convert from view to world coords

    createNode({
      name: 'New Node',
      type: 'custom',
      icon: '◆',
      z: clampDisk(worldZ, 0.02),
      parent: state.focus, // Link to focused node
      editable: true
    });
  }
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const hit = hitTest(e.offsetX, e.offsetY);
  if (hit) {
    state.focus = hit.id;
    state.selected.clear();
    state.selected.add(hit.id);
    showContextMenu(e.clientX, e.clientY, hit);
  }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.002);
  state.targetZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.targetZoom * factor));
}, { passive: false });

// ════════════════════════════════════════════════════════════════════════════
// MINIMAP INTERACTION
// ════════════════════════════════════════════════════════════════════════════

const MINI_W = 100, MINI_H = 80, MINI_R = 35;
const MINI_CX = MINI_W / 2, MINI_CY = MINI_H / 2;

let miniDragging = false;
let miniClickStart = null;

function minimapScreenToWorld(x, y) {
  // Convert minimap screen coords to world (untransformed) disk coords
  // The minimap shows transformed view, so we need to invert
  const dx = (x - MINI_CX) / MINI_R;
  const dy = (y - MINI_CY) / MINI_R;
  let r = Math.sqrt(dx * dx + dy * dy);

  // Clamp to disk interior
  let zView = C(dx, dy);
  if (r >= 0.95) {
    const scale = 0.95 / r;
    zView = C(dx * scale, dy * scale);
  }

  // The minimap shows mobius(camera, worldPos), so invert to get worldPos
  return mobiusInv(state.camera, zView);
}

/**
 * Convert Klein disk point to Poincaré disk.
 * Klein disk maps: k -> k / (1 + sqrt(1 - |k|²))
 */
function kleinToPoincare(k) {
  const r2 = cabs2(k);
  if (r2 >= 1) {
    // Clamp to disk edge
    const r = Math.sqrt(r2);
    const scale = 0.95 / r;
    return { re: k.re * scale, im: k.im * scale };
  }
  const denom = 1 + Math.sqrt(1 - r2);
  return { re: k.re / denom, im: k.im / denom };
}

function kleinMinimapScreenToWorld(x, y) {
  // Convert Klein minimap coords to Poincaré, then to world
  const dx = (x - MINI_CX) / MINI_R;
  const dy = (y - MINI_CY) / MINI_R;

  // Clamp to disk interior
  let r = Math.sqrt(dx * dx + dy * dy);
  let kView = C(dx, dy);
  if (r >= 0.95) {
    const scale = 0.95 / r;
    kView = C(dx * scale, dy * scale);
  }

  // Convert Klein -> Poincaré -> world
  const pView = kleinToPoincare(kView);
  return mobiusInv(state.camera, pView);
}

function handleMinimapPan(e) {
  if (!miniCanvas) return;
  const rect = miniCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Get world position under cursor
  const worldPos = minimapScreenToWorld(x, y);

  // Set camera target to this world position
  state.targetCamera = clampDisk(worldPos);
  state.velocity = C(0, 0);
}

if (miniCanvas) {
  miniCanvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    miniCanvas.setPointerCapture(e.pointerId);
    miniDragging = true;
    miniClickStart = { x: e.clientX, y: e.clientY, time: Date.now() };

    handleMinimapPan(e);
  });

  miniCanvas.addEventListener('pointermove', e => {
    if (!miniDragging) return;
    handleMinimapPan(e);
  });

  miniCanvas.addEventListener('pointerup', e => {
    if (miniDragging && miniClickStart) {
      const dx = e.clientX - miniClickStart.x;
      const dy = e.clientY - miniClickStart.y;
      const dt = Date.now() - miniClickStart.time;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // If it was a quick tap without movement, find nearest node and focus it
      if (dist < 5 && dt < 200) {
        const rect = miniCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldPos = minimapScreenToWorld(x, y);

        // Find nearest node to click position
        const graph = currentGraph();
        let nearest = null;
        let nearestDist = Infinity;

        for (const node of graph.nodes.values()) {
          if (node.hidden) continue;
          const d = hypDist(worldPos, node.z);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = node;
          }
        }

        // If close enough, focus that node
        if (nearest && nearestDist < 0.5) {
          focusNode(nearest.id);
        }
      }
    }

    miniDragging = false;
    miniClickStart = null;
  });

  miniCanvas.addEventListener('pointercancel', () => {
    miniDragging = false;
    miniClickStart = null;
  });

  // Double-click minimap to reset view (show all)
  miniCanvas.addEventListener('dblclick', e => {
    e.preventDefault();
    state.targetCamera = C(0, 0);
    state.targetZoom = 1;
    state.velocity = C(0, 0);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// KLEIN MINIMAP INTERACTION
// ═══════════════════════════════════════════════════════════════════════════

function handleKleinMinimapPan(e) {
  if (!kleinCanvas) return;
  const rect = kleinCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Get world position under cursor (converting from Klein coords)
  const worldPos = kleinMinimapScreenToWorld(x, y);

  // Set camera target to this world position
  state.targetCamera = clampDisk(worldPos);
  state.velocity = C(0, 0);
}

if (kleinCanvas) {
  let kleinDragging = false;

  kleinCanvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    kleinCanvas.setPointerCapture(e.pointerId);
    kleinDragging = true;
    handleKleinMinimapPan(e);
  });

  kleinCanvas.addEventListener('pointermove', e => {
    if (!kleinDragging) return;
    handleKleinMinimapPan(e);
  });

  kleinCanvas.addEventListener('pointerup', () => {
    kleinDragging = false;
  });

  kleinCanvas.addEventListener('pointercancel', () => {
    kleinDragging = false;
  });

  // Double-click Klein minimap to reset view
  kleinCanvas.addEventListener('dblclick', e => {
    e.preventDefault();
    state.targetCamera = C(0, 0);
    state.targetZoom = 1;
    state.velocity = C(0, 0);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════════════════════

function focusNode(id, options = {}) {
  const graph = currentGraph();
  const node = graph.nodes.get(id);
  if (!node) return;

  const { addToPath = false, zoom = true } = options;

  state.focus = id;

  // If adding to path, don't clear selection
  if (!addToPath) {
    state.selected.clear();
    state.selected.add(id);
  }

  // Semantic zoom: move camera to node AND zoom based on local structure
  state.targetCamera = clampDisk(node.z);

  if (zoom) {
    // Compute local density - more children = zoom out more
    const childCount = node.children.length;

    // Semantic zoom level based on local structure
    if (childCount === 0) {
      // Leaf node - zoom in close
      state.targetZoom = Math.min(SEMANTIC_ZOOM_LEAF_MAX, state.targetZoom * ZOOM_STEP);
    } else if (childCount > SEMANTIC_ZOOM_MANY_CHILDREN) {
      // Many children - zoom out to see them
      state.targetZoom = Math.max(SEMANTIC_ZOOM_MIN, 1.0 - childCount * 0.05);
    } else {
      // Normal zoom
      state.targetZoom = 1.0;
    }
  }

  if (!state.settings.features.animations) {
    state.camera = state.targetCamera;
    state.zoom = state.targetZoom;
  }
  state.velocity = C(0, 0);

  // Add to recent
  if (!state.recent.includes(id)) {
    state.recent.unshift(id);
    if (state.recent.length > 10) state.recent.pop();
  }

  // Execute node action if it has one
  if (node.action && typeof node.action === 'function') {
    try {
      node.action(node, graph);
      showToast(`⚡ ${node.name}`);
    } catch (e) {
      console.error('Node action failed:', e);
      showToast(`❌ Action failed: ${e.message}`);
    }
  }

  pushHistory();
  updatePanel();
  updateBreadcrumb();
  updateSelectionBadge();
  scheduleAutoSave();  // Persist camera/focus state
}

function goHome() {
  state.focus = 0;
  state.selected.clear();
  state.selected.add(0);
  state.targetCamera = C(0, 0);
  state.targetZoom = 1;
  if (!state.settings.features.animations) {
    state.camera = C(0, 0);
    state.zoom = 1;
  }
  state.velocity = C(0, 0);
  pushHistory();
  updatePanel();
  updateBreadcrumb();
}

function goToParent() {
  const node = currentGraph().nodes.get(state.focus);
  if (node && node.parent !== null) {
    focusNode(node.parent);
  }
}

function pushHistory() {
  state.history = state.history.slice(0, state.historyIdx + 1);
  state.history.push({
    space: state.currentSpace,
    focus: state.focus,
    camera: C(state.camera.re, state.camera.im),
    zoom: state.zoom
  });
  state.historyIdx = state.history.length - 1;
  if (state.history.length > 50) {
    state.history.shift();
    state.historyIdx--;
  }
}

function goBack() {
  if (state.historyIdx > 0) {
    state.historyIdx--;
    applyHistory(state.history[state.historyIdx]);
  }
}

function goForward() {
  if (state.historyIdx < state.history.length - 1) {
    state.historyIdx++;
    applyHistory(state.history[state.historyIdx]);
  }
}

function applyHistory(h) {
  if (h.space !== state.currentSpace) {
    switchSpace(h.space, false);
  }
  state.focus = h.focus;
  state.selected.clear();
  state.selected.add(h.focus);
  state.targetCamera = h.camera;
  state.targetZoom = h.zoom;
  if (!state.settings.features.animations) {
    state.camera = h.camera;
    state.zoom = h.zoom;
  }
  updatePanel();
  updateBreadcrumb();
}

function switchSpace(key, resetHistory = true) {
  state.currentSpace = key;
  state.camera = C(0, 0);
  state.targetCamera = C(0, 0);
  state.zoom = 1;
  state.targetZoom = 1;
  state.focus = 0;
  state.selected.clear();
  state.selected.add(0);
  state.velocity = C(0, 0);
  state.pathNodes = [];
  state.recent = [];

  // Invalidate caches for new graph
  invalidateRenderCache();
  invalidateHitTestCache();

  if (resetHistory) {
    state.history = [];
    state.historyIdx = -1;
    pushHistory();
  }

  const space = currentSpace();

  // Update dock
  document.querySelectorAll('.dock-item[data-space]').forEach(el => {
    el.classList.toggle('active', el.dataset.space === key);
    el.style.setProperty('--accent', el.dataset.space === key ? space.color : '');
  });

  // Update main color
  document.documentElement.style.setProperty('--space-color', space.color);
  mainEl.style.setProperty('--space-color', space.color);

  // Update space indicator
  setText('spaceName', space.name);
  setText('spaceMeta', `${currentGraph().nodes.size} nodes`);

  updatePanel();
  updateBreadcrumb();
  updateStats();
  updatePathBadge();
  scheduleAutoSave();  // Persist space change
}

// ════════════════════════════════════════════════════════════════════════════
// UI UPDATES
// ════════════════════════════════════════════════════════════════════════════

// HUD update caching - avoid redundant DOM updates and expensive calculations
let hudCache = {
  focus: null,
  zoom: null,
  lastVisibleCount: 0,
  lastVisibleUpdate: 0
};
const HUD_VISIBLE_UPDATE_INTERVAL = 200; // Only recalculate visible count every 200ms

function updateHUD() {
  const graph = currentGraph();
  const node = graph.nodes.get(state.focus);
  if (!node) return;

  // Only update focus-related fields if focus changed
  if (hudCache.focus !== state.focus) {
    const elFocus = document.getElementById('metricFocus');
    const elDepth = document.getElementById('metricDepth');
    const elDist = document.getElementById('metricDist');
    if (elFocus) elFocus.textContent = node.name;
    if (elDepth) elDepth.textContent = node.depth;
    if (elDist) elDist.textContent = hypDist(C(0, 0), node.z).toFixed(2);
    hudCache.focus = state.focus;
  }

  // Update zoom display (changes frequently during animation)
  const zoomStr = state.zoom.toFixed(2);
  if (hudCache.zoom !== zoomStr) {
    const elZoom = document.getElementById('metricZoom');
    if (elZoom) elZoom.textContent = zoomStr;
    hudCache.zoom = zoomStr;
  }

  // Throttle visible node count - expensive calculation
  const now = performance.now();
  if (now - hudCache.lastVisibleUpdate > HUD_VISIBLE_UPDATE_INTERVAL) {
    const visible = [...graph.nodes.values()].filter(n => !n.hidden && cabs(transformNode(n)) < 1.1).length;
    if (visible !== hudCache.lastVisibleCount) {
      const elVisible = document.getElementById('metricVisible');
      if (elVisible) elVisible.textContent = visible;
      hudCache.lastVisibleCount = visible;
    }
    hudCache.lastVisibleUpdate = now;
  }
}

function updatePanel() {
  const graph = currentGraph();
  const space = currentSpace();
  const node = graph.nodes.get(state.focus);
  if (!node) return;

  // Avatar
  const avatar = document.getElementById('nodeAvatar');
  if (avatar) {
    avatar.textContent = node.icon;
    avatar.className = 'node-avatar' + (node.pinned ? ' pinned' : '');
    avatar.style.background = node.pinned ? 'rgba(255,181,116,.15)' : `${space.color}15`;
    avatar.style.borderColor = node.pinned ? 'rgba(255,181,116,.3)' : `${space.color}30`;
  }

  // Info
  setText('nodeName', node.name);
  setText('nodeType', `${node.type} · depth ${node.depth}`);

  // Badges
  const badges = document.getElementById('nodeBadges');
  if (!badges) return;
  badges.innerHTML = '';

  const depthBadge = document.createElement('span');
  depthBadge.className = 'badge depth';
  depthBadge.textContent = `Level ${node.depth}`;
  badges.appendChild(depthBadge);

  if (node.pinned) {
    const pinBadge = document.createElement('span');
    pinBadge.className = 'badge pinned';
    pinBadge.textContent = 'Pinned';
    badges.appendChild(pinBadge);
  }

  // Properties
  const propsGrid = document.getElementById('propsGrid');
  propsGrid.innerHTML = '';

  const props = [
    { label: 'ID', value: node.id },
    { label: 'Children', value: node.children.length },
    { label: '|z|', value: cabs(node.z).toFixed(4) },
    { label: 'd(0,z)', value: hypDist(C(0, 0), node.z).toFixed(3) },
    { label: 'Camera', value: `${state.camera.re.toFixed(3)} + ${state.camera.im.toFixed(3)}i`, full: true, mono: true }
  ];

  props.forEach(({ label, value, full, mono }) => {
    const card = document.createElement('div');
    card.className = 'prop-card' + (full ? ' full' : '');
    card.innerHTML = `
      <div class="prop-label">${label}</div>
      <div class="prop-value${mono ? ' mono' : ''}">${value}</div>
    `;
    propsGrid.appendChild(card);
  });

  // Tags
  const tagsSection = document.getElementById('tagsSection');
  const tagsList = document.getElementById('tagsList');

  if (node.tags.length > 0) {
    tagsSection.style.display = 'block';
    tagsList.innerHTML = '';

    const tagColors = {
      favorite: '#ffd666',
      important: '#ffb574',
      core: '#6eb5ff',
      advanced: '#d2a8ff',
      hot: '#ff9bce',
      wip: '#7ee787',
      done: '#79c0ff',
      todo: '#a0a0a8',
      critical: '#ff7b7b',
      healthy: '#7ee787',
      degraded: '#ffb574',
      active: '#6eb5ff'
    };

    node.tags.forEach(tag => {
      const el = document.createElement('span');
      el.className = 'tag';
      el.textContent = tag;
      const color = tagColors[tag] || '#79c0ff';
      el.style.background = `${color}20`;
      el.style.color = color;
      tagsList.appendChild(el);
    });
  } else {
    tagsSection.style.display = 'none';
  }

  // Related nodes
  const relatedList = document.getElementById('relatedList');
  relatedList.innerHTML = '';

  const relatedIds = [...node.children];
  if (node.parent !== null) relatedIds.unshift(node.parent);

  relatedIds.slice(0, 6).forEach(id => {
    const rel = graph.nodes.get(id);
    if (!rel) return;

    const item = document.createElement('div');
    item.className = 'related-item';
    item.innerHTML = `
      <div class="related-dot" style="background:${depthColor(rel.depth)}"></div>
      <div class="related-info">
        <div class="related-name">${rel.name}</div>
        <div class="related-meta">${rel.type} · d${rel.depth}</div>
      </div>
      <div class="related-action">→</div>
    `;
    item.onclick = () => focusNode(rel.id);
    relatedList.appendChild(item);
  });

  // Update pin button
  setHTML('actPin', `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
    ${node.pinned ? 'Unpin' : 'Pin'}
  `);

  // Content/Notes
  const contentDisplay = document.getElementById('contentDisplay');
  const contentEditor = document.getElementById('contentEditor');
  if (node.content && node.content.trim()) {
    contentDisplay.innerHTML = escapeHtml(node.content);
  } else {
    contentDisplay.innerHTML = '<span class="empty-hint">No notes. Click Edit to add.</span>';
  }
  contentEditor.value = node.content || '';
  contentEditor.style.display = 'none';
  setText('editContent', 'Edit');

  // Bookmarks tab
  updateBookmarks();
}

// Helper to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateBreadcrumb() {
  const graph = currentGraph();
  const crumb = document.getElementById('breadcrumb');
  crumb.innerHTML = '';

  const path = [];
  let cur = graph.nodes.get(state.focus);
  while (cur) {
    path.unshift(cur);
    cur = cur.parent !== null ? graph.nodes.get(cur.parent) : null;
  }

  path.forEach((node, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      crumb.appendChild(sep);
    }

    const el = document.createElement('span');
    el.className = 'crumb' + (i === path.length - 1 ? ' current' : '');
    el.textContent = node.name;
    el.onclick = () => focusNode(node.id);
    crumb.appendChild(el);
  });
}

function updateSelectionBadge() {
  const badge = document.getElementById('selectionBadge');
  if (!badge) return;
  const count = state.selected.size;
  badge.classList.toggle('visible', count > 1);
  setText('selCount', count);
}

function updatePathBadge() {
  const badge = document.getElementById('pathBadge');
  if (!badge) return;
  const graph = currentGraph();

  // No path at all
  if (state.pathNodes.length === 0) {
    badge.classList.remove('visible');
    return;
  }

  const pathNodeObjs = state.pathNodes.map(id => graph.nodes.get(id)).filter(Boolean);
  if (pathNodeObjs.length === 0) {
    badge.classList.remove('visible');
    return;
  }

  badge.classList.add('visible');

  const first = pathNodeObjs[0];
  const last = pathNodeObjs[pathNodeObjs.length - 1];

  // Show path info
  if (pathNodeObjs.length === 1) {
    setText('pathStart', first.name);
    setText('pathEnd', 'click next...');
    setText('pathDist', '—');
    setText('pathHops', '1');
  } else {
    setText('pathStart', first.name);
    setText('pathEnd', last.name);

    // Total geodesic distance along path
    let totalDist = 0;
    for (let i = 0; i < pathNodeObjs.length - 1; i++) {
      totalDist += hypDist(pathNodeObjs[i].z, pathNodeObjs[i + 1].z);
    }
    setText('pathDist', totalDist.toFixed(3));
    setText('pathHops', pathNodeObjs.length);
  }
}

function updateBookmarks() {
  const graph = currentGraph();

  // Pinned
  const pinnedList = document.getElementById('pinnedList');
  const pinned = [...graph.nodes.values()].filter(n => n.pinned);

  if (pinned.length === 0) {
    pinnedList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No pinned nodes</div>
        <div class="empty-state-desc">Shift+click to pin nodes</div>
      </div>
    `;
  } else {
    pinnedList.innerHTML = '';
    pinned.forEach(node => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      item.innerHTML = `
        <div class="bookmark-color" style="background:${depthColor(node.depth)}"></div>
        <div class="bookmark-info">
          <div class="bookmark-name">${node.name}</div>
          <div class="bookmark-path">Depth ${node.depth}</div>
        </div>
        <button class="bookmark-remove" data-id="${node.id}">×</button>
      `;
      item.onclick = e => {
        if (e.target.classList.contains('bookmark-remove')) {
          node.pinned = false;
          updateBookmarks();
          updatePanel();
        } else {
          focusNode(node.id);
        }
      };
      pinnedList.appendChild(item);
    });
  }

  // Recent
  const recentList = document.getElementById('recentList');
  if (state.recent.length === 0) {
    recentList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-desc">Navigate to see history</div>
      </div>
    `;
  } else {
    recentList.innerHTML = '';
    state.recent.slice(0, 8).forEach(id => {
      const node = graph.nodes.get(id);
      if (!node) return;

      const item = document.createElement('div');
      item.className = 'bookmark-item';
      item.innerHTML = `
        <div class="bookmark-color" style="background:${depthColor(node.depth)}"></div>
        <div class="bookmark-info">
          <div class="bookmark-name">${node.name}</div>
          <div class="bookmark-path">${node.type}</div>
        </div>
      `;
      item.onclick = () => focusNode(node.id);
      recentList.appendChild(item);
    });
  }
}

function updateStats() {
  const graph = currentGraph();
  setText('statNodes', graph.nodes.size);
  setText('statEdges', graph.edges.length);
  setText('statPinned', [...graph.nodes.values()].filter(n => n.pinned).length);
  setText('statDepth', graph.maxDepth);
}

// ════════════════════════════════════════════════════════════════════════════
// TOOLTIP
// ════════════════════════════════════════════════════════════════════════════

const tooltip = document.getElementById('tooltip');

function showTooltip(node, x, y) {
  if (!tooltip) return;
  setText('tooltipIcon', node.icon);
  setText('tooltipTitle', node.name);
  setText('tooltipType', node.type);
  setText('tooltipDepth', node.depth);
  setText('tooltipChildren', node.children.length);

  const tagsEl = document.getElementById('tooltipTags');
  if (tagsEl) {
    if (node.tags.length > 0) {
      tagsEl.style.display = 'flex';
      tagsEl.innerHTML = node.tags.map(t => `<span class="tooltip-tag">${t}</span>`).join('');
    } else {
      tagsEl.style.display = 'none';
    }
  }

  tooltip.style.left = (x + 16) + 'px';
  tooltip.style.top = (y + 16) + 'px';
  tooltip.classList.add('visible');
}

function hideTooltip() {
  if (tooltip) tooltip.classList.remove('visible');
}

// Toast notification
let toastTimeout = null;
function showToast(message, duration = 2000) {
  if (!tooltip) return;
  setText('tooltipIcon', 'ℹ');
  setText('tooltipTitle', message);
  setText('tooltipType', '');
  setText('tooltipDepth', '');
  setText('tooltipChildren', '');
  const tagsEl = document.getElementById('tooltipTags');
  if (tagsEl) tagsEl.style.display = 'none';

  tooltip.style.left = '50%';
  tooltip.style.top = '80px';
  tooltip.style.transform = 'translateX(-50%)';
  tooltip.classList.add('visible');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    tooltip.classList.remove('visible');
    tooltip.style.transform = '';
  }, duration);
}

// ════════════════════════════════════════════════════════════════════════════
// CONTEXT MENU
// ════════════════════════════════════════════════════════════════════════════

const contextMenu = document.getElementById('contextMenu');
let contextNode = null;

function showContextMenu(x, y, node) {
  contextNode = node;
  contextMenu.classList.add('visible');
  // Boundary detection: keep menu fully on-screen
  const rect = contextMenu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (x + rect.width > vw - 8) x = vw - rect.width - 8;
  if (y + rect.height > vh - 8) y = vh - rect.height - 8;
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
}

function hideContextMenu() {
  contextMenu.classList.remove('visible');
  contextNode = null;
}

contextMenu.addEventListener('click', e => {
  const item = e.target.closest('.context-item');
  if (!item || !contextNode) return;

  const action = item.dataset.action;
  const graph = currentGraph();

  switch (action) {
    case 'focus':
      focusNode(contextNode.id);
      break;
    case 'pin':
      contextNode.pinned = !contextNode.pinned;
      updatePanel();
      break;
    case 'select-children':
      contextNode.children.forEach(id => state.selected.add(id));
      updateSelectionBadge();
      break;
    case 'select-ancestors':
      let cur = contextNode;
      while (cur) {
        state.selected.add(cur.id);
        cur = cur.parent !== null ? graph.nodes.get(cur.parent) : null;
      }
      updateSelectionBadge();
      break;
    case 'path-from':
      state.pathNodes = [contextNode.id];
      setMode('path');
      updatePathBadge();
      break;
    case 'path-to':
      if (state.pathNodes.length > 0) {
        state.pathNodes.push(contextNode.id);
        updatePathBadge();
      }
      break;
    case 'copy':
      navigator.clipboard?.writeText(JSON.stringify({
        id: contextNode.id,
        name: contextNode.name,
        type: contextNode.type,
        depth: contextNode.depth,
        tags: contextNode.tags
      }, null, 2));
      break;
    case 'rename':
      const newName = prompt('Rename node:', contextNode.name);
      if (newName && newName.trim()) {
        renameNode(contextNode.id, newName.trim());
      }
      break;
    case 'add-child':
      const childName = prompt('New child node name:');
      if (childName && childName.trim()) {
        createNode({
          name: childName.trim(),
          type: contextNode.type,
          icon: '◇',
          parent: contextNode.id
        });
      }
      break;
    case 'link-to':
      state.linkDragFrom = contextNode.id;
      state.mode = 'link';
      if (typeof updateModeIndicator === 'function') updateModeIndicator();
      break;
    case 'reparent':
      state.editingNode = contextNode.id;
      state.mode = 'reparent';
      if (typeof updateModeIndicator === 'function') updateModeIndicator();
      break;
    case 'set-action':
      const actionList = Object.keys(nodeActions).join(', ');
      const newAction = prompt(`Set action (available: ${actionList}):`, contextNode.action || '');
      if (newAction !== null) {
        setNodeAction(contextNode.id, newAction.trim() || null);
      }
      break;
    case 'hide':
      contextNode.hidden = true;
      break;
    case 'delete':
      if (confirm(`Delete "${contextNode.name}" and all children?`)) {
        deleteNode(contextNode.id);
      }
      break;
  }

  hideContextMenu();
});

document.addEventListener('click', e => {
  if (!contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

// ════════════════════════════════════════════════════════════════════════════
// COMMAND PALETTE
// ════════════════════════════════════════════════════════════════════════════

const commandOverlay = document.getElementById('commandOverlay');
const commandInput = document.getElementById('commandInput');
const commandResults = document.getElementById('commandResults');

let commandSelected = 0;
let commandItems = [];

function openCommandPalette() {
  state.commandOpen = true;
  commandOverlay.classList.add('visible');
  commandInput.value = '';
  commandInput.focus();
  updateCommandResults('');
}

function closeCommandPalette() {
  state.commandOpen = false;
  commandOverlay.classList.remove('visible');
}

function updateCommandResults(query) {
  const graph = currentGraph();
  const q = query.toLowerCase().trim();

  commandItems = [];

  // Actions
  const actions = [
    { type: 'action', name: 'Go Home', desc: 'Return to root node', shortcut: 'H', action: goHome },
    { type: 'action', name: 'Go to Parent', desc: 'Navigate to parent node', shortcut: '↑', action: goToParent },
    { type: 'action', name: 'Toggle Focus Mode', desc: 'Hide UI for presentation', shortcut: 'F', action: toggleFocusMode },
    { type: 'action', name: 'Clear Selection', desc: 'Deselect all nodes', shortcut: 'Esc', action: () => { state.selected.clear(); state.selected.add(state.focus); updateSelectionBadge(); }},
    { type: 'action', name: 'Clear Path', desc: 'Remove path measurement', action: () => { state.pathNodes = []; updatePathBadge(); }},
    { type: 'action', name: 'Zoom In', desc: 'Increase zoom level', shortcut: '+', action: () => { state.targetZoom = Math.min(ZOOM_MAX, state.targetZoom * ZOOM_STEP); }},
    { type: 'action', name: 'Zoom Out', desc: 'Decrease zoom level', shortcut: '-', action: () => { state.targetZoom = Math.max(ZOOM_MIN, state.targetZoom / ZOOM_STEP); }},
    { type: 'action', name: 'Reset Zoom', desc: 'Return to 1x zoom', shortcut: '0', action: () => { state.targetZoom = 1; }}
  ];

  // Spaces
  const spaces = Object.entries(SPACES).map(([key, space]) => ({
    type: 'space',
    name: space.name,
    desc: `Switch to ${space.name}`,
    icon: space.rootIcon,
    action: () => switchSpace(key)
  }));

  // Nodes
  const nodes = [...graph.nodes.values()].map(node => ({
    type: 'node',
    name: node.name,
    desc: `${node.type} · depth ${node.depth}`,
    icon: node.icon,
    action: () => focusNode(node.id)
  }));

  // Filter
  const all = [...actions, ...spaces, ...nodes];

  if (q) {
    commandItems = all.filter(item =>
      item.name.toLowerCase().includes(q) ||
      (item.desc && item.desc.toLowerCase().includes(q))
    ).slice(0, 15);
  } else {
    commandItems = [...actions.slice(0, 4), ...spaces, ...nodes.slice(0, 6)];
  }

  commandSelected = 0;
  renderCommandResults(q);
}

function renderCommandResults(query) {
  if (commandItems.length === 0) {
    commandResults.innerHTML = '<div class="command-empty">No results found<div style="margin-top:8px;font-size:11px;color:var(--text-disabled)">Try a different search or press Esc</div></div>';
    return;
  }

  const groups = {};
  commandItems.forEach((item, i) => {
    if (!groups[item.type]) groups[item.type] = [];
    groups[item.type].push({ ...item, index: i });
  });

  const groupNames = { action: 'Actions', space: 'Spaces', node: 'Nodes' };

  let html = '';
  Object.entries(groups).forEach(([type, items]) => {
    html += `<div class="command-group">`;
    html += `<div class="command-group-title">${groupNames[type]}</div>`;
    items.forEach(item => {
      const isSelected = item.index === commandSelected;
      const title = query ? highlightMatch(item.name, query) : item.name;
      html += `
        <div class="command-item${isSelected ? ' selected' : ''}" data-index="${item.index}">
          <div class="command-icon">${item.icon || '⌘'}</div>
          <div class="command-text">
            <div class="command-title">${title}</div>
            <div class="command-desc">${item.desc}</div>
          </div>
          ${item.shortcut ? `<div class="command-shortcut"><kbd>${item.shortcut}</kbd></div>` : ''}
        </div>
      `;
    });
    html += '</div>';
  });

  commandResults.innerHTML = html;

  // Click handlers
  commandResults.querySelectorAll('.command-item').forEach(el => {
    el.onclick = () => {
      const item = commandItems[parseInt(el.dataset.index)];
      if (item) {
        item.action();
        closeCommandPalette();
      }
    };
  });
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return text.slice(0, idx) + '<mark>' + text.slice(idx, idx + query.length) + '</mark>' + text.slice(idx + query.length);
}

commandInput.addEventListener('input', e => {
  updateCommandResults(e.target.value);
});

commandInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    commandSelected = Math.min(commandSelected + 1, commandItems.length - 1);
    renderCommandResults(commandInput.value);
    requestAnimationFrame(() => { const el = commandResults.querySelector('.command-item.selected'); if (el) el.scrollIntoView({ block: 'nearest' }); });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    commandSelected = Math.max(commandSelected - 1, 0);
    renderCommandResults(commandInput.value);
    requestAnimationFrame(() => { const el = commandResults.querySelector('.command-item.selected'); if (el) el.scrollIntoView({ block: 'nearest' }); });
  } else if (e.key === 'Home') {
    e.preventDefault();
    commandSelected = 0;
    renderCommandResults(commandInput.value);
  } else if (e.key === 'End') {
    e.preventDefault();
    commandSelected = Math.max(commandItems.length - 1, 0);
    renderCommandResults(commandInput.value);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = commandItems[commandSelected];
    if (item) {
      item.action();
      closeCommandPalette();
    }
  } else if (e.key === 'Escape') {
    closeCommandPalette();
  }
});

commandOverlay.addEventListener('click', e => {
  if (e.target === commandOverlay) {
    closeCommandPalette();
  }
});

document.getElementById('searchTrigger').onclick = openCommandPalette;

// ════════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════════════════════

const keyboardHints = document.getElementById('keyboardHints');

function toggleKeyboardHints() {
  state.keyboardHintsOpen = !state.keyboardHintsOpen;
  keyboardHints.classList.toggle('visible', state.keyboardHintsOpen);
}

keyboardHints.onclick = e => {
  if (e.target === keyboardHints) {
    state.keyboardHintsOpen = false;
    keyboardHints.classList.remove('visible');
  }
};

function toggleFocusMode() {
  state.focusMode = !state.focusMode;
  document.getElementById('app').classList.toggle('focus-mode', state.focusMode);
  // Resize canvas after layout change to ensure proper dimensions
  requestAnimationFrame(resize);
}

function setMode(mode) {
  state.mode = mode;
  mainEl.dataset.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (mode !== 'path') {
    state.pathNodes = [];
    state.pathAnimating = false;
    updatePathBadge();
  }

  // Update mode indicator
  if (typeof updateModeIndicator === 'function') updateModeIndicator();
}

document.addEventListener('keydown', e => {
  // Skip if in input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }

  // Command palette
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openCommandPalette();
    return;
  }

  // Undo/Redo
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      redo();
    } else {
      undo();
    }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
    e.preventDefault();
    redo();
    return;
  }

  // Export (Ctrl+E)
  if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
    e.preventDefault();
    exportGraph();
    return;
  }

  // Escape key - hierarchical dismissal
  if (e.key === 'Escape') {
    hideContextMenu(); // Always hide context menu

    // Priority 0: Cancel link/reparent modes
    if (state.mode === 'link' || state.mode === 'reparent') {
      state.mode = 'nav';
      state.linkDragFrom = null;
      state.editingNode = null;
      if (typeof updateModeIndicator === 'function') updateModeIndicator();
      showToast('Cancelled');
      return;
    }
    // Priority 1: Exit focus/presentation mode
    if (state.focusMode) {
      toggleFocusMode();
      return;
    }
    // Priority 2: Close command palette
    if (state.commandOpen) {
      closeCommandPalette();
      return;
    }
    // Priority 3: Close keyboard hints
    if (state.keyboardHintsOpen) {
      toggleKeyboardHints();
      return;
    }
    // Priority 4: Exit path mode
    if (state.mode === 'path') {
      state.mode = 'nav';
      state.pathNodes = [];
      updatePathBadge();
      if (typeof updateModeIndicator === 'function') updateModeIndicator();
      return;
    }
    // Priority 5: Clear path measurement
    if (state.pathNodes.length > 0) {
      state.pathNodes = [];
      updatePathBadge();
      if (typeof updateModeIndicator === 'function') updateModeIndicator();
      return;
    }
    // Priority 6: Clear multi-selection (keep only focused node)
    if (state.selected.size > 1) {
      state.selected.clear();
      state.selected.add(state.focus);
      updateSelectionBadge();
      return;
    }
    // Priority 7: Navigate to parent node
    const currentNode = currentGraph().nodes.get(state.focus);
    if (currentNode && currentNode.parent !== null) {
      goToParent();
      return;
    }
    // At root with nothing to dismiss - do nothing
    return;
  }

  // Keyboard hints
  if (e.key === '?') {
    toggleKeyboardHints();
    return;
  }

  // Navigation - vim style hjkl + arrows
  switch (e.key) {
    // Go home
    case 'H':
      goHome();
      break;

    // Go to parent (k or up arrow)
    case 'k':
    case 'ArrowUp':
      goToParent();
      break;

    // Go to first child (j or down arrow)
    case 'j':
    case 'ArrowDown':
      {
        const node = currentGraph().nodes.get(state.focus);
        if (node && node.children.length > 0) {
          focusNode(node.children[0]);
        }
      }
      break;

    // Go to previous sibling (h or left arrow)
    case 'h':
    case 'ArrowLeft':
      {
        const graph = currentGraph();
        const node = graph.nodes.get(state.focus);
        if (node && node.parent !== null) {
          const parent = graph.nodes.get(node.parent);
          if (parent) {
            const idx = parent.children.indexOf(node.id);
            if (idx > 0) {
              focusNode(parent.children[idx - 1]);
            }
          }
        }
      }
      break;

    // Go to next sibling (l or right arrow)
    case 'l':
    case 'ArrowRight':
      {
        const graph = currentGraph();
        const node = graph.nodes.get(state.focus);
        if (node && node.parent !== null) {
          const parent = graph.nodes.get(node.parent);
          if (parent) {
            const idx = parent.children.indexOf(node.id);
            if (idx < parent.children.length - 1) {
              focusNode(parent.children[idx + 1]);
            }
          }
        }
      }
      break;

    // History navigation
    case '[':
      if (e.metaKey || e.ctrlKey) { e.preventDefault(); goBack(); }
      break;
    case ']':
      if (e.metaKey || e.ctrlKey) { e.preventDefault(); goForward(); }
      break;

    // Modes
    case 'v':
    case 'V':
      setMode('pan');
      break;
    case 's':
    case 'S':
      setMode('select');
      break;
    case 'm':
    case 'M':
      setMode('path');
      break;
    // Focus mode moved to Shift+F to avoid conflict with fold
    case 'F':
      if (e.shiftKey) {
        toggleFocusMode();
      }
      break;

    // Zoom
    case '=':
    case '+':
      state.targetZoom = Math.min(ZOOM_MAX, state.targetZoom * ZOOM_STEP);
      break;
    case '-':
      state.targetZoom = Math.max(ZOOM_MIN, state.targetZoom / ZOOM_STEP);
      break;
    case '0':
      state.targetZoom = 1;
      break;

    // Spaces (0 = Hyperbolic intro, 1-7 = content spaces, 8 = embeddings)
    case '0':
      switchSpace('hyperbolic');
      break;
    case '1':
      switchSpace('hyperbolic');
      break;
    case '2':
      switchSpace('infra');
      break;
    case '3':
      switchSpace('github');
      break;
    case '4':
      switchSpace('notes');
      break;
    case '5':
      switchSpace('math');
      break;
    case '6':
      switchSpace('langs');
      break;
    case '7':
      switchSpace('ux');
      break;
    case '8':
      switchSpace('embeddings');
      break;

    // Pin
    case 'p':
    case 'P':
      const pinNode = currentGraph().nodes.get(state.focus);
      if (pinNode) {
        pinNode.pinned = !pinNode.pinned;
        // Relayout nodes around pinned anchors
        relayoutAroundPins(currentGraph(), 0.3, 15);
        updatePanel();
        updateBookmarks();
      }
      break;

    // Fold - compress selection into bounded shape
    case 'f':
      {
        const graph = currentGraph();
        const foldNode = graph.nodes.get(state.focus);

        // If focused node IS a fold, unfold it
        if (foldNode && foldNode.isFold) {
          const restored = unfold(graph, foldNode.foldId);
          // Focus on restored node instead of going home
          if (typeof restored === 'string' || typeof restored === 'number') {
            focusNode(restored);
          } else {
            goHome();
          }
          updatePanel();
          break;
        }

        // Otherwise, fold selected nodes (or focused subtree)
        let nodesToFold = [...state.selected];
        if (nodesToFold.length === 0 && state.focus !== null) {
          // Fold the focused node and all its descendants
          const focused = graph.nodes.get(state.focus);
          if (focused && focused.children.length > 0) {
            nodesToFold = [state.focus];
            const queue = [...focused.children];
            while (queue.length > 0) {
              const id = queue.shift();
              nodesToFold.push(id);
              const child = graph.nodes.get(id);
              if (child) queue.push(...child.children);
            }
          }
        }

        if (nodesToFold.length > 0) {
          const name = prompt('Name this fold:', `Fold ${foldIdCounter + 1}`);
          if (name !== null) {
            const foldId = fold(graph, nodesToFold, name);
            if (foldId) {
              state.selected.clear();
              focusNode(foldId);
            }
          }
        }
      }
      break;

    // Unfold - expand fold at cursor (also 'u')
    case 'u':
    case 'U':
      {
        const graph = currentGraph();
        const foldNode = graph.nodes.get(state.focus);
        if (foldNode && foldNode.isFold) {
          const restored = unfold(graph, foldNode.foldId);
          // Focus on restored node instead of going home
          if (typeof restored === 'string' || typeof restored === 'number') {
            focusNode(restored);
          } else {
            goHome();
          }
          updatePanel();
        }
      }
      break;

    // Witness Cut - acknowledge and release
    case 'w':
    case 'W':
      if (e.shiftKey) {
        witnessAndRelease();
      }
      break;

    // Overlay toggles (O + key)
    case 'o':
    case 'O':
      // Cycle through overlays with O, or specific with modifiers
      if (e.shiftKey) {
        // Shift+O: toggle all overlays off
        state.settings.overlays.voronoi = false;
        state.settings.overlays.tiling = false;
        state.settings.overlays.transport = false;
        state.settings.overlays.hypercycles = false;
        state.settings.overlays.horocycles = false;
        state.settings.overlays.idealPoints = false;
        state.settings.overlays.circumcircles = false;
        showToast('Overlays cleared');
      } else if (e.altKey) {
        // Alt+O: toggle tiling
        state.settings.overlays.tiling = !state.settings.overlays.tiling;
        showToast(`Tiling ${state.settings.overlays.tiling ? 'on' : 'off'}`);
      } else {
        // O alone: cycle through interesting overlays
        const overlays = ['idealPoints', 'horocycles', 'hypercycles', 'circumcircles', 'voronoi', 'tiling'];
        const current = overlays.findIndex(k => state.settings.overlays[k]);
        overlays.forEach(k => state.settings.overlays[k] = false);
        const next = (current + 1) % (overlays.length + 1);
        if (next < overlays.length) {
          state.settings.overlays[overlays[next]] = true;
          showToast(`Overlay: ${overlays[next]}`);
        } else {
          showToast('Overlays off');
        }
      }
      scheduleAutoSave();
      break;

    // Grid toggle
    case 'g':
    case 'G':
      state.settings.features.grid = !state.settings.features.grid;
      scheduleAutoSave();
      break;

    // Projection shortcuts: 1=Poincaré, 2=Klein, 3=Half-plane
    case '1':
      setProjection('poincare');
      break;
    case '2':
      setProjection('klein');
      break;
    case '3':
      setProjection('halfplane');
      break;

    // Minimap toggle (m cycles through: Poincaré -> Klein -> Half-plane -> Tree -> Off)
    case 'm':
    case 'M':
      if (e.shiftKey) {
        // Shift+M: all minimaps off
        state.settings.minimaps.poincare = false;
        state.settings.minimaps.klein = false;
        state.settings.minimaps.halfplane = false;
        state.settings.minimaps.tree = false;
        showToast('Minimaps off');
      } else {
        // Cycle minimaps
        const mmaps = ['poincare', 'klein', 'halfplane', 'tree'];
        const currentIdx = mmaps.findIndex(m => state.settings.minimaps[m]);
        mmaps.forEach(m => state.settings.minimaps[m] = false);
        const nextIdx = (currentIdx + 1) % (mmaps.length + 1);
        if (nextIdx < mmaps.length) {
          state.settings.minimaps[mmaps[nextIdx]] = true;
          showToast(`Minimap: ${mmaps[nextIdx]}`);
        } else {
          showToast('Minimaps off');
        }
      }
      scheduleAutoSave();
      break;
  }
});

// Helper function to set projection from keyboard
function setProjection(proj) {
  state.settings.view.projection = proj;
  if (projectionManager) {
    projectionManager.setModel(proj);
  }
  invalidateRenderCache();
  document.querySelectorAll('[data-projection]').forEach(b => {
    b.classList.toggle('active', b.dataset.projection === proj);
  });
  const names = {
    poincare: 'Poincaré disk',
    klein: 'Klein disk (straight geodesics)',
    halfplane: 'Upper half-plane'
  };
  showToast(names[proj] || proj);
  scheduleAutoSave();
}

// ════════════════════════════════════════════════════════════════════════════
// PROJECTION & VIEW SWITCHES
// ════════════════════════════════════════════════════════════════════════════

// Projection switch (P/K/H buttons)
// All three projections are now implemented via HyperbolicProjections module
document.querySelectorAll('[data-projection]').forEach(btn => {
  btn.addEventListener('click', () => {
    const proj = btn.dataset.projection;
    state.settings.view.projection = proj;

    // Update projection manager
    if (projectionManager) {
      projectionManager.setModel(proj);
    }

    // Invalidate render cache since coordinates changed
    invalidateRenderCache();

    // Update active state
    document.querySelectorAll('[data-projection]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Show status message
    const names = {
      poincare: 'Poincaré disk (conformal)',
      klein: 'Klein disk (geodesics are straight lines)',
      halfplane: 'Upper half-plane (conformal)'
    };
    showToast(names[proj] || proj);
  });
});

// View mode switch (F/O/T buttons)
document.querySelectorAll('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    state.settings.view.viewMode = view;

    // Update active state
    document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Apply view mode - Focus and Overview work, Tree is placeholder
    if (view === 'focus') {
      // Focus mode: zoom follows selection (IMPLEMENTED)
      state.settings.view.autoZoom = true;
      showToast('Focus mode: follows selection');
    } else if (view === 'overview') {
      // Overview: show everything (IMPLEMENTED)
      state.targetCamera = C(0, 0);
      state.targetZoom = 0.8;
      state.settings.view.autoZoom = false;
      showToast('Overview mode: full graph');
    } else if (view === 'tree') {
      // Tree view: emphasize hierarchy (PLACEHOLDER)
      state.settings.view.autoZoom = false;
      showToast('Tree view - coming soon');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DOCK TOOLTIPS
// ════════════════════════════════════════════════════════════════════════════

const dockTooltip = document.getElementById('dockTooltip');

document.querySelectorAll('.dock-item').forEach(item => {
  item.addEventListener('mouseenter', e => {
    const label = item.dataset.tooltip;
    const shortcut = item.dataset.shortcut;
    if (!label) return;

    dockTooltip.querySelector('.label').textContent = label;
    const shortcutEl = dockTooltip.querySelector('.shortcut');
    if (shortcut) {
      shortcutEl.textContent = shortcut;
      shortcutEl.style.display = '';
    } else {
      shortcutEl.style.display = 'none';
    }

    const rect = item.getBoundingClientRect();
    dockTooltip.style.top = (rect.top + rect.height / 2 - 14) + 'px';
    dockTooltip.classList.add('visible');
  });

  item.addEventListener('mouseleave', () => {
    dockTooltip.classList.remove('visible');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BUTTON HANDLERS
// ════════════════════════════════════════════════════════════════════════════

// Dock
document.querySelectorAll('.dock-item[data-space]').forEach(el => {
  el.onclick = () => switchSpace(el.dataset.space);
});

document.querySelectorAll('.dock-item[data-action]').forEach(el => {
  el.onclick = () => {
    const action = el.dataset.action;
    if (action === 'focus-mode') toggleFocusMode();
    else if (action === 'keyboard-hints') toggleKeyboardHints();
    else if (action === 'path') setMode('path');
  };
});

// Topbar
document.getElementById('btnHome').onclick = goHome;
document.getElementById('btnBack').onclick = goBack;
document.getElementById('btnFwd').onclick = goForward;
document.getElementById('btnZoomIn').onclick = () => { state.targetZoom = Math.min(ZOOM_MAX, state.targetZoom * ZOOM_STEP); };
document.getElementById('btnZoomOut').onclick = () => { state.targetZoom = Math.max(ZOOM_MIN, state.targetZoom / ZOOM_STEP); };
document.getElementById('btnFit').onclick = () => { state.targetZoom = 1; state.targetCamera = C(0, 0); };

// Export/Import
document.getElementById('btnExport').onclick = exportGraph;
document.getElementById('btnImport').onclick = () => {
  document.getElementById('importInput').click();
};
document.getElementById('importInput').onchange = (e) => {
  if (e.target.files.length > 0) {
    importGraph(e.target.files[0]);
    e.target.value = ''; // Reset for next import
  }
};

// Mode buttons
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.onclick = () => setMode(btn.dataset.mode);
});

// Panel actions
document.getElementById('actCenter').onclick = () => {
  const node = currentGraph().nodes.get(state.focus);
  if (node) {
    state.targetCamera = clampDisk(node.z);
    state.velocity = C(0, 0);
  }
};

document.getElementById('actPin').onclick = () => {
  const node = currentGraph().nodes.get(state.focus);
  if (node) {
    node.pinned = !node.pinned;
    updatePanel();
  }
};

document.getElementById('actParent').onclick = goToParent;

document.getElementById('actExpand').onclick = () => {
  state.targetZoom = Math.min(ZOOM_MAX, state.targetZoom * 1.5);
};

// Selection badge
document.getElementById('selClear').onclick = () => {
  state.selected.clear();
  state.selected.add(state.focus);
  updateSelectionBadge();
};

document.getElementById('selPin').onclick = () => {
  const graph = currentGraph();
  state.selected.forEach(id => {
    const node = graph.nodes.get(id);
    if (node) node.pinned = true;
  });
  updatePanel();
};

// Path badge
document.getElementById('pathAnimate').onclick = () => {
  state.pathAnimating = !state.pathAnimating;
  state.pathAnimT = 0;
};

document.getElementById('pathClear').onclick = () => {
  state.pathNodes = [];
  state.pathAnimating = false;
  updatePathBadge();
};

// Content editing
const contentDisplay = document.getElementById('contentDisplay');
const contentEditor = document.getElementById('contentEditor');
const editContentBtn = document.getElementById('editContent');

editContentBtn.onclick = () => {
  const isEditing = contentEditor.style.display !== 'none';
  if (isEditing) {
    // Save
    const node = currentGraph().nodes.get(state.focus);
    if (node) {
      setNodeContent(node.id, contentEditor.value);
    }
    contentEditor.style.display = 'none';
    contentDisplay.style.display = 'block';
    editContentBtn.textContent = 'Edit';
  } else {
    // Start editing
    contentEditor.style.display = 'block';
    contentDisplay.style.display = 'none';
    contentEditor.focus();
    editContentBtn.textContent = 'Save';
  }
};

contentEditor.onblur = () => {
  // Auto-save on blur (with small delay to allow button click)
  setTimeout(() => {
    if (contentEditor.style.display !== 'none') {
      const node = currentGraph().nodes.get(state.focus);
      if (node && node.content !== contentEditor.value) {
        setNodeContent(node.id, contentEditor.value);
      }
    }
  }, 100);
};

contentEditor.onkeydown = (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    contentEditor.style.display = 'none';
    contentDisplay.style.display = 'block';
    editContentBtn.textContent = 'Edit';
    updatePanel();
  }
  // Ctrl+Enter to save
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    const node = currentGraph().nodes.get(state.focus);
    if (node) {
      setNodeContent(node.id, contentEditor.value);
    }
    contentEditor.style.display = 'none';
    contentDisplay.style.display = 'block';
    editContentBtn.textContent = 'Edit';
  }
};

// Mode indicator
const modeIndicator = document.getElementById('modeIndicator');
const modeIcon = modeIndicator.querySelector('.mode-icon');
const modeText = modeIndicator.querySelector('.mode-text');

function updateModeIndicator() {
  if (state.mode === 'link') {
    modeIcon.textContent = '⌁';
    modeText.textContent = 'Link mode: click target node';
    modeIndicator.className = 'mode-indicator visible link';
  } else if (state.mode === 'reparent') {
    modeIcon.textContent = '↷';
    modeText.textContent = 'Move mode: click new parent';
    modeIndicator.className = 'mode-indicator visible reparent';
  } else if (state.mode === 'path' && state.pathNodes.length > 0) {
    modeIcon.textContent = '📍';
    modeText.textContent = `Path: ${state.pathNodes.length} nodes`;
    modeIndicator.className = 'mode-indicator visible path';
  } else {
    modeIndicator.className = 'mode-indicator';
  }
}

// Panel tabs
document.querySelectorAll('.panel-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  };
});

// Settings toggles
document.querySelectorAll('.toggle[data-setting]').forEach(toggle => {
  const key = toggle.dataset.setting;
  toggle.classList.toggle('on', state.settings[key]);
  toggle.onclick = () => {
    state.settings[key] = !state.settings[key];
    toggle.classList.toggle('on', state.settings[key]);
  };
});

// Clear pins
document.getElementById('clearAllPins').onclick = () => {
  const graph = currentGraph();
  for (const node of graph.nodes.values()) {
    node.pinned = false;
  }
  updateBookmarks();
  updatePanel();
};

// Show all connected nodes
document.getElementById('showAllRelated').onclick = () => {
  const graph = currentGraph();
  const focusedNode = graph.nodes.get(state.focus);
  if (!focusedNode) return;

  // Collect all connected nodes (parent, children, siblings)
  const related = new Set([focusedNode.id]);

  // Add parent
  if (focusedNode.parent !== null) {
    related.add(focusedNode.parent);
    // Add siblings (other children of same parent)
    const parentNode = graph.nodes.get(focusedNode.parent);
    if (parentNode) {
      parentNode.children.forEach(id => related.add(id));
    }
  }

  // Add children
  focusedNode.children.forEach(id => related.add(id));

  // Update selection
  state.selected = related;
  updateSelectionBadge();

  // Compute hyperbolic centroid of related nodes using Lorentz geometry
  const nodeIds = [...related].filter(id => {
    const n = graph.nodes.get(id);
    return n && !n.hidden;
  });

  if (nodeIds.length === 0) return;

  if (nodeIds.length === 1) {
    const node = graph.nodes.get(nodeIds[0]);
    state.targetCamera = clampDisk(node.z);
    state.targetZoom = 1.2;
  } else {
    // Use Lorentz centroid for proper hyperbolic mean
    const centroid = computeLorentzCentroid(graph, nodeIds);
    state.targetCamera = clampDisk(centroid);

    // Compute spread in hyperbolic distance
    let maxDist = 0;
    for (const id of nodeIds) {
      const node = graph.nodes.get(id);
      if (node) {
        maxDist = Math.max(maxDist, hypDist(centroid, node.z));
      }
    }

    // Zoom level based on hyperbolic spread
    const spread = maxDist > 1.5 ? 0.6 : maxDist > 1.0 ? 0.8 : maxDist > 0.5 ? 1.0 : 1.2;
    state.targetZoom = spread;
  }

  state.velocity = C(0, 0);
};

// ════════════════════════════════════════════════════════════════════════════
// LEGEND
// ════════════════════════════════════════════════════════════════════════════

const legend = document.getElementById('legend');
DEPTH_COLORS.forEach((color, i) => {
  const item = document.createElement('div');
  item.className = 'legend-item';
  item.innerHTML = `
    <div class="legend-dot" style="background:${color}"></div>
    <div class="legend-label">${i}</div>
  `;
  legend.appendChild(item);
});

// ════════════════════════════════════════════════════════════════════════════
// THEME SYSTEM
// ════════════════════════════════════════════════════════════════════════════

const THEMES = {
  default: {
    name: 'Default',
    canvasBg: '#050608',
    gridColor: 'rgba(255,255,255,0.03)',
    gridMajorColor: 'rgba(255,255,255,0.08)',
    edgeColor: 'rgba(255,255,255,0.15)',
    nodeStroke: 'rgba(255,255,255,0.2)',
    labelColor: '#f0f0f2',
    diskBorder: 'rgba(255,255,255,0.1)',
    nodeGlow: true,
    edgeShadow: false
  },
  minimalist: {
    name: 'Minimalist',
    canvasBg: '#ffffff',
    gridColor: '#e8e8e8',
    gridMajorColor: '#d0d0d0',
    edgeColor: '#606060',
    nodeStroke: '#303030',
    labelColor: '#1a1a1a',
    diskBorder: '#404040',
    nodeGlow: false,
    edgeShadow: false
  },
  skeuomorphic: {
    name: 'Skeuomorphic',
    canvasBg: '#1a1612',
    gridColor: 'rgba(180,160,120,0.06)',
    gridMajorColor: 'rgba(180,160,120,0.12)',
    edgeColor: 'rgba(200,180,140,0.25)',
    nodeStroke: 'rgba(255,220,160,0.4)',
    labelColor: '#f5e8d8',
    diskBorder: 'rgba(200,180,140,0.3)',
    nodeGlow: true,
    edgeShadow: true
  }
};

function getThemeColors() {
  return THEMES[state.settings.theme] || THEMES.default;
}

function setTheme(themeName) {
  if (!THEMES[themeName]) themeName = 'default';

  state.settings.theme = themeName;

  // Apply to document
  if (themeName === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', themeName);
  }

  // Update theme selector UI
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === themeName);
  });

  // Persist preference
  try {
    localStorage.setItem('umbra-theme', themeName);
  } catch (e) {}

  showToast(`Theme: ${THEMES[themeName].name}`);
}

function initTheme() {
  // Load saved theme
  try {
    const saved = localStorage.getItem('umbra-theme');
    if (saved && THEMES[saved]) {
      state.settings.theme = saved;
      if (saved !== 'default') {
        document.documentElement.setAttribute('data-theme', saved);
      }
    }
  } catch (e) {}

  // Set up theme selector clicks
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => {
      setTheme(opt.dataset.theme);
    });
    // Mark current theme as active
    if (opt.dataset.theme === state.settings.theme) {
      opt.classList.add('active');
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════

// Initialize persistence system (loads settings & camera)
initPersistence();

// Initialize theme
initTheme();

// Initialize UI (use persisted currentSpace if available)
switchSpace(state.currentSpace || 'hyperbolic', false);
pushHistory();
updatePanel();
updateBreadcrumb();
updateStats();

// Set initial space color
document.documentElement.style.setProperty('--space-color', currentSpace().color);

// Start render loop
console.log('[HyperbolicEngine] Starting render loop');
requestAnimationFrame(render);

// ════════════════════════════════════════════════════════════════════════════
// MOBILE SUPPORT
// ════════════════════════════════════════════════════════════════════════════

const isMobile = window.matchMedia('(max-width: 768px)').matches;
const mobileToggleDock = document.getElementById('mobileToggleDock');
const mobileTogglePanel = document.getElementById('mobileTogglePanel');
const mobileBackdrop = document.getElementById('mobileBackdrop');
const dock = document.getElementById('dock');
const panel = document.querySelector('.panel');

function closeMobileSidebars() {
  dock?.classList.remove('mobile-open');
  panel?.classList.remove('mobile-open');
  mobileBackdrop?.classList.remove('visible');
}

if (mobileToggleDock) {
  mobileToggleDock.addEventListener('click', () => {
    const isOpen = dock?.classList.toggle('mobile-open');
    panel?.classList.remove('mobile-open');
    mobileBackdrop?.classList.toggle('visible', isOpen);
  });
}

if (mobileTogglePanel) {
  mobileTogglePanel.addEventListener('click', () => {
    const isOpen = panel?.classList.toggle('mobile-open');
    dock?.classList.remove('mobile-open');
    mobileBackdrop?.classList.toggle('visible', isOpen);
  });
}

if (mobileBackdrop) {
  mobileBackdrop.addEventListener('click', closeMobileSidebars);
}

// Close sidebars when selecting a space on mobile
document.querySelectorAll('.dock-item[data-space]').forEach(item => {
  item.addEventListener('click', () => {
    if (isMobile) closeMobileSidebars();
  });
});

// Swipe gesture support for mobile
let touchStartX = 0;
let touchStartY = 0;

canvas.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

canvas.addEventListener('touchend', e => {
  const touchEndX = e.changedTouches[0].clientX;
  const touchEndY = e.changedTouches[0].clientY;
  const dx = touchEndX - touchStartX;
  const dy = touchEndY - touchStartY;

  // Horizontal swipe detection (min 50px, more horizontal than vertical)
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx > 0 && touchStartX < 30) {
      // Swipe right from left edge - open dock
      dock?.classList.add('mobile-open');
      mobileBackdrop?.classList.add('visible');
    } else if (dx < 0 && touchStartX > window.innerWidth - 30) {
      // Swipe left from right edge - open panel
      panel?.classList.add('mobile-open');
      mobileBackdrop?.classList.add('visible');
    }
  }
}, { passive: true });

console.log('Hyperbolic Workspace Pro initialized');
console.log('Press ? for keyboard shortcuts');
if (isMobile) console.log('Mobile mode: swipe from edges to open sidebars');

// ════════════════════════════════════════════════════════════════════════════
// GLOBAL API - Expose persistence and core functions for console/external use
// ════════════════════════════════════════════════════════════════════════════
window.UmbraAPI = {
  // Persistence
  exportGraph,
  importGraph,
  resetPersistence,
  saveSettings,
  loadSettings,
  getStorageStats,

  // State access (read-only recommended)
  getState: () => ({ ...state, graphs: {} }),  // Shallow copy without graphs
  getSettings: () => JSON.parse(JSON.stringify(state.settings)),

  // Graph access
  getCurrentGraph: currentGraph,
  getNode: (id) => currentGraph().nodes.get(id),

  // Navigation
  focusNode,
  goHome,
  switchSpace,

  // Actions
  globalActions,

  // Version info
  version: '2.0.0-persistence',
  persistenceVersion: PERSISTENCE_VERSION
};

console.log('[UmbraAPI] Global API available at window.UmbraAPI');
console.log('[UmbraAPI] Storage stats:', getStorageStats());
