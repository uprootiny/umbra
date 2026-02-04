/**
 * HYPERBOLIC PROJECTIONS - Multiple Model Support
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Complete implementation of the three main models of hyperbolic geometry:
 *
 * 1. POINCARÉ DISK (B^n)
 *    - Conformal: angles are preserved
 *    - Geodesics are circular arcs perpendicular to boundary
 *    - Boundary is the unit circle
 *
 * 2. KLEIN DISK (K^n)
 *    - NOT conformal: angles are distorted
 *    - Geodesics are STRAIGHT LINES (Euclidean chords)
 *    - Boundary is the unit circle
 *    - Useful for: intersection calculations, convex hulls
 *
 * 3. UPPER HALF-PLANE (U^n)
 *    - Conformal: angles are preserved
 *    - Geodesics are vertical lines or semicircles centered on x-axis
 *    - Boundary is the x-axis plus point at infinity
 *    - Natural for: horocycles, modular forms
 *
 * Each model provides:
 * - Coordinate conversion to/from Poincaré
 * - Distance calculation
 * - Geodesic arc computation for rendering
 * - Screen coordinate mapping
 */

'use strict';

console.log('[HyperbolicProjections] Loading...');

const PROJ_EPSILON = 1e-10;
const PROJ_CLAMP = 1 - 1e-5;

// ════════════════════════════════════════════════════════════════════════════
// COMPLEX NUMBER HELPERS (local to this module, prefixed to avoid conflicts)
// ════════════════════════════════════════════════════════════════════════════

function projC(re, im = 0) {
  return { re: Number.isFinite(re) ? re : 0, im: Number.isFinite(im) ? im : 0 };
}

function projCadd(a, b) { return projC(a.re + b.re, a.im + b.im); }
function projCsub(a, b) { return projC(a.re - b.re, a.im - b.im); }
function projCmul(a, b) { return projC(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
function projCconj(a) { return projC(a.re, -a.im); }
function projCabs2(a) { return a.re * a.re + a.im * a.im; }
function projCabs(a) { return Math.sqrt(projCabs2(a)); }
function projCscale(a, k) { return projC(a.re * k, a.im * k); }

function projCdiv(a, b) {
  const d = projCabs2(b);
  if (d < PROJ_EPSILON) return projC(0, 0);
  return projC((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}

function projCarg(a) { return Math.atan2(a.im, a.re); }
function projCpolar(r, t) { return projC(r * Math.cos(t), r * Math.sin(t)); }

// ════════════════════════════════════════════════════════════════════════════
// MODEL 1: POINCARÉ DISK
// ════════════════════════════════════════════════════════════════════════════

const PoincareDisk = {
  name: 'Poincaré Disk',
  shortName: 'poincare',

  /**
   * Clamp point to disk interior
   */
  clamp(z, eps = 1e-5) {
    const r = projCabs(z);
    return r >= 1 - eps ? projCscale(z, (1 - eps) / r) : z;
  },

  /**
   * Möbius transformation: T_a(z) = (z - a) / (1 - conj(a)*z)
   */
  mobius(a, z) {
    if (projCabs(a) < PROJ_EPSILON) return z;
    const num = projCsub(z, a);
    const den = projCsub(projC(1), projCmul(projCconj(a), z));
    return this.clamp(projCdiv(num, den));
  },

  /**
   * Inverse Möbius
   */
  mobiusInv(a, w) {
    if (projCabs(a) < PROJ_EPSILON) return w;
    const num = projCadd(w, a);
    const den = projCadd(projC(1), projCmul(projCconj(a), w));
    return this.clamp(projCdiv(num, den));
  },

  /**
   * Hyperbolic distance
   */
  distance(z, w) {
    const diff = projCsub(z, w);
    if (projCabs(diff) < PROJ_EPSILON) return 0;

    const num = projCabs(diff);
    const den = projCabs(projCsub(projC(1), projCmul(projCconj(z), w)));
    if (den < PROJ_EPSILON) return Infinity;

    const ratio = Math.min(num / den, PROJ_CLAMP);
    return 2 * Math.atanh(ratio);
  },

  /**
   * Geodesic interpolation
   */
  geodesicLerp(z1, z2, t) {
    if (t <= 0) return z1;
    if (t >= 1) return z2;

    const w = this.mobius(z1, z2);
    const r = projCabs(w);
    if (r < PROJ_EPSILON) return z1;

    const rClamped = Math.min(r, PROJ_CLAMP);
    const rInterp = Math.tanh(t * Math.atanh(rClamped));

    return this.mobiusInv(z1, projCpolar(rInterp, projCarg(w)));
  },

  /**
   * Compute geodesic arc for rendering
   */
  geodesicArc(z1, z2) {
    if (projCabs(projCsub(z1, z2)) < PROJ_EPSILON) return null;

    // Cross product determines if near a diameter
    const cross = z1.re * z2.im - z1.im * z2.re;

    if (Math.abs(cross) < 1e-4) {
      return { type: 'line', z1, z2 };
    }

    // Circle center for geodesic perpendicular to boundary
    const r1 = projCabs2(z1), r2 = projCabs2(z2);
    const denom = 2 * cross;
    const cx = ((1 + r1) * z2.im - (1 + r2) * z1.im) / denom;
    const cy = ((1 + r2) * z1.re - (1 + r1) * z2.re) / denom;
    const center = projC(cx, cy);
    const radius = projCabs(projCsub(z1, center));

    return { type: 'arc', center, radius };
  },

  /**
   * Convert to screen coordinates
   */
  toScreen(z, cx, cy, R, zoom) {
    return {
      x: cx + z.re * R * zoom,
      y: cy + z.im * R * zoom
    };
  },

  /**
   * Convert from screen coordinates
   */
  fromScreen(x, y, cx, cy, R, zoom) {
    return projC((x - cx) / (R * zoom), (y - cy) / (R * zoom));
  }
};

// ════════════════════════════════════════════════════════════════════════════
// MODEL 2: KLEIN DISK
// ════════════════════════════════════════════════════════════════════════════

const KleinDisk = {
  name: 'Klein Disk',
  shortName: 'klein',

  /**
   * Poincaré to Klein: k = 2p / (1 + |p|²)
   */
  fromPoincare(z) {
    const r2 = projCabs2(z);
    const factor = 2 / (1 + r2);
    return projC(z.re * factor, z.im * factor);
  },

  /**
   * Klein to Poincaré: p = k / (1 + √(1 - |k|²))
   */
  toPoincare(k) {
    const r2 = projCabs2(k);
    if (r2 >= 1) {
      const r = Math.sqrt(r2);
      k = projCscale(k, PROJ_CLAMP / r);
    }
    const factor = 1 / (1 + Math.sqrt(Math.max(0, 1 - projCabs2(k))));
    return projC(k.re * factor, k.im * factor);
  },

  /**
   * Clamp to Klein disk interior
   */
  clamp(k, eps = 1e-5) {
    const r = projCabs(k);
    return r >= 1 - eps ? projCscale(k, (1 - eps) / r) : k;
  },

  /**
   * Klein isometry (projective transformation)
   * Moving center a to origin
   */
  isometry(a, z) {
    // Convert to Poincaré, apply Möbius, convert back
    const pA = this.toPoincare(a);
    const pZ = this.toPoincare(z);
    const pResult = PoincareDisk.mobius(pA, pZ);
    return this.fromPoincare(pResult);
  },

  /**
   * Hyperbolic distance in Klein model
   * Uses cross-ratio with ideal points
   */
  distance(k1, k2) {
    // Convert to Poincaré for distance calculation
    return PoincareDisk.distance(this.toPoincare(k1), this.toPoincare(k2));
  },

  /**
   * Geodesic in Klein model is a STRAIGHT LINE (chord)
   */
  geodesicArc(k1, k2) {
    // Klein geodesics are always straight lines!
    return { type: 'line', z1: k1, z2: k2 };
  },

  /**
   * Geodesic interpolation (linear in Klein, which is NOT geodesic lerp!)
   * For true geodesic lerp, convert to Poincaré
   */
  geodesicLerp(k1, k2, t) {
    const p1 = this.toPoincare(k1);
    const p2 = this.toPoincare(k2);
    const pResult = PoincareDisk.geodesicLerp(p1, p2, t);
    return this.fromPoincare(pResult);
  },

  /**
   * Convert to screen coordinates
   */
  toScreen(k, cx, cy, R, zoom) {
    return {
      x: cx + k.re * R * zoom,
      y: cy + k.im * R * zoom
    };
  },

  /**
   * Convert from screen coordinates
   */
  fromScreen(x, y, cx, cy, R, zoom) {
    return projC((x - cx) / (R * zoom), (y - cy) / (R * zoom));
  },

  /**
   * Key advantage: line-line intersection is trivial
   */
  geodesicIntersection(k1, k2, k3, k4) {
    // Standard line-line intersection
    const x1 = k1.re, y1 = k1.im;
    const x2 = k2.re, y2 = k2.im;
    const x3 = k3.re, y3 = k3.im;
    const x4 = k4.re, y4 = k4.im;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < PROJ_EPSILON) return null; // Parallel

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const x = x1 + t * (x2 - x1);
    const y = y1 + t * (y2 - y1);

    const result = projC(x, y);
    // Check if inside disk
    return projCabs(result) < 1 ? result : null;
  }
};

// ════════════════════════════════════════════════════════════════════════════
// MODEL 3: UPPER HALF-PLANE
// ════════════════════════════════════════════════════════════════════════════

const UpperHalfPlane = {
  name: 'Upper Half-Plane',
  shortName: 'halfplane',

  /**
   * Poincaré to upper half-plane: w = i(1 + z) / (1 - z)
   */
  fromPoincare(z) {
    const one = projC(1, 0);
    const i = projC(0, 1);

    const num = projCmul(i, projCadd(one, z));  // i(1 + z)
    const den = projCsub(one, z);            // (1 - z)

    if (projCabs(den) < PROJ_EPSILON) {
      // z ≈ 1 maps to infinity
      return projC(0, 1e10);
    }

    return projCdiv(num, den);
  },

  /**
   * Upper half-plane to Poincaré: z = (w - i) / (w + i)
   */
  toPoincare(w) {
    const i = projC(0, 1);

    const num = projCsub(w, i);  // w - i
    const den = projCadd(w, i);  // w + i

    if (projCabs(den) < PROJ_EPSILON) {
      // w ≈ -i would map outside, clamp
      return projC(0, -PROJ_CLAMP);
    }

    return PoincareDisk.clamp(projCdiv(num, den));
  },

  /**
   * Ensure point is in upper half-plane (im > 0)
   */
  clamp(w, eps = 1e-5) {
    return projC(w.re, Math.max(eps, w.im));
  },

  /**
   * Möbius transformation in upper half-plane
   * Uses PSL(2,R) matrices: (az + b)/(cz + d), ad - bc = 1
   */
  mobius(a, b, c, d, z) {
    const num = projCadd(projCmul(projC(a, 0), z), projC(b, 0));
    const den = projCadd(projCmul(projC(c, 0), z), projC(d, 0));
    return projCdiv(num, den);
  },

  /**
   * Hyperbolic distance in upper half-plane
   * d(z, w) = 2 arctanh(|z - w| / |z - conj(w)|)
   */
  distance(z, w) {
    const diff = projCsub(z, w);
    const diffConj = projCsub(z, projCconj(w));

    const num = projCabs(diff);
    const den = projCabs(diffConj);

    if (den < PROJ_EPSILON) return Infinity;
    const ratio = Math.min(num / den, PROJ_CLAMP);

    return 2 * Math.atanh(ratio);
  },

  /**
   * Geodesic arc in upper half-plane:
   * - Vertical lines (when re(z1) = re(z2))
   * - Semicircles centered on real axis
   */
  geodesicArc(z1, z2) {
    const dx = Math.abs(z1.re - z2.re);

    if (dx < PROJ_EPSILON) {
      // Vertical line
      return { type: 'line', z1, z2 };
    }

    // Semicircle centered on real axis
    // Center is at intersection of perpendicular bisector with x-axis
    const midX = (z1.re + z2.re) / 2;
    const midY = (z1.im + z2.im) / 2;

    // Perpendicular bisector slope
    const slope = -(z2.re - z1.re) / (z2.im - z1.im + PROJ_EPSILON);

    // x-intercept: y = 0 = midY + slope * (x - midX)
    const centerX = midX - midY / slope;
    const center = projC(centerX, 0);
    const radius = projCabs(projCsub(z1, center));

    return { type: 'arc', center, radius };
  },

  /**
   * Geodesic interpolation
   */
  geodesicLerp(z1, z2, t) {
    // Convert to Poincaré, interpolate, convert back
    const p1 = this.toPoincare(z1);
    const p2 = this.toPoincare(z2);
    const pResult = PoincareDisk.geodesicLerp(p1, p2, t);
    return this.fromPoincare(pResult);
  },

  /**
   * Convert to screen coordinates
   * Upper half-plane is infinite, so we use a viewport transformation
   */
  toScreen(w, cx, cy, R, zoom, viewCenter = projC(0, 1)) {
    // Translate so viewCenter is at screen center, scale by zoom
    const shifted = projCsub(w, viewCenter);
    return {
      x: cx + shifted.re * R * zoom,
      y: cy - shifted.im * R * zoom  // Flip y since screen y increases downward
    };
  },

  /**
   * Convert from screen coordinates
   */
  fromScreen(x, y, cx, cy, R, zoom, viewCenter = projC(0, 1)) {
    const shifted = projC((x - cx) / (R * zoom), -(y - cy) / (R * zoom));
    return this.clamp(projCadd(shifted, viewCenter));
  },

  /**
   * Horocycle centered at ideal point ξ on real axis, through point w
   */
  horocycle(xi, w, numPoints = 64) {
    // Horocycle is a horizontal line or circle tangent to x-axis at xi
    if (!Number.isFinite(xi)) {
      // Horocycle centered at infinity is a horizontal line y = w.im
      const points = [];
      for (let i = 0; i <= numPoints; i++) {
        const x = w.re + (i - numPoints / 2) * 0.1;
        points.push(projC(x, w.im));
      }
      return points;
    }

    // Horocycle tangent to x-axis at xi
    const radius = Math.abs(w.im) / 2;
    const centerY = w.im / 2;

    const points = [];
    for (let i = 0; i <= numPoints; i++) {
      const t = (i / numPoints) * Math.PI;  // Upper semicircle only
      points.push(projC(xi + radius * Math.cos(t), centerY + radius * Math.sin(t)));
    }
    return points;
  }
};

// ════════════════════════════════════════════════════════════════════════════
// UNIFIED PROJECTION INTERFACE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Projection manager - handles all three models uniformly
 */
class ProjectionManager {
  constructor(initialModel = 'poincare') {
    this.models = {
      poincare: PoincareDisk,
      klein: KleinDisk,
      halfplane: UpperHalfPlane
    };
    this.currentModel = initialModel;

    // Half-plane specific state
    this.halfplaneCenter = projC(0, 1);
  }

  get model() {
    return this.models[this.currentModel];
  }

  setModel(name) {
    if (this.models[name]) {
      this.currentModel = name;
      return true;
    }
    return false;
  }

  /**
   * Convert point from Poincaré to current model
   */
  fromPoincare(z) {
    switch (this.currentModel) {
      case 'poincare': return z;
      case 'klein': return KleinDisk.fromPoincare(z);
      case 'halfplane': return UpperHalfPlane.fromPoincare(z);
    }
  }

  /**
   * Convert point from current model to Poincaré
   */
  toPoincare(p) {
    switch (this.currentModel) {
      case 'poincare': return p;
      case 'klein': return KleinDisk.toPoincare(p);
      case 'halfplane': return UpperHalfPlane.toPoincare(p);
    }
  }

  /**
   * Apply camera transformation in current model
   */
  applyCamera(camera, z) {
    // Convert everything to Poincaré, apply Möbius, convert back
    const pCamera = this.toPoincare(this.fromPoincare(camera));
    const pZ = this.toPoincare(this.fromPoincare(z));
    const pResult = PoincareDisk.mobius(pCamera, pZ);
    return this.fromPoincare(pResult);
  }

  /**
   * Get geodesic arc for rendering
   */
  geodesicArc(z1, z2) {
    return this.model.geodesicArc(z1, z2);
  }

  /**
   * Convert to screen coordinates
   */
  toScreen(z, cx, cy, R, zoom) {
    if (this.currentModel === 'halfplane') {
      return UpperHalfPlane.toScreen(z, cx, cy, R, zoom, this.halfplaneCenter);
    }
    return this.model.toScreen(z, cx, cy, R, zoom);
  }

  /**
   * Convert from screen coordinates
   */
  fromScreen(x, y, cx, cy, R, zoom) {
    if (this.currentModel === 'halfplane') {
      return UpperHalfPlane.fromScreen(x, y, cx, cy, R, zoom, this.halfplaneCenter);
    }
    return this.model.fromScreen(x, y, cx, cy, R, zoom);
  }

  /**
   * Draw boundary for current model
   */
  drawBoundary(ctx, cx, cy, R) {
    ctx.beginPath();

    switch (this.currentModel) {
      case 'poincare':
      case 'klein':
        // Unit circle boundary
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        break;

      case 'halfplane':
        // Real axis (horizontal line at y = cy + R)
        ctx.moveTo(cx - R * 2, cy + R);
        ctx.lineTo(cx + R * 2, cy + R);
        break;
    }

    ctx.stroke();
  }

  /**
   * Draw geodesic edge between two points
   */
  drawGeodesic(ctx, z1, z2, cx, cy, R, zoom) {
    const arc = this.geodesicArc(z1, z2);
    if (!arc) return;

    const p1 = this.toScreen(z1, cx, cy, R, zoom);
    const p2 = this.toScreen(z2, cx, cy, R, zoom);

    ctx.beginPath();

    if (arc.type === 'line') {
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    } else {
      const pc = this.toScreen(arc.center, cx, cy, R, zoom);
      const sR = arc.radius * R * zoom;

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

// ════════════════════════════════════════════════════════════════════════════
// HIGHER-DIMENSIONAL EXTENSIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Higher-dimensional Poincaré ball B^n
 */
const PoincareBall = {
  /**
   * Möbius addition in B^n
   */
  mobiusAdd(x, y) {
    const x2 = x.reduce((s, v) => s + v * v, 0);
    const y2 = y.reduce((s, v) => s + v * v, 0);
    const xy = x.reduce((s, v, i) => s + v * y[i], 0);

    const denom = 1 + 2 * xy + x2 * y2;
    if (Math.abs(denom) < PROJ_EPSILON) return x.slice();

    const coeffX = 1 + 2 * xy + y2;
    const coeffY = 1 - x2;

    return x.map((v, i) => (coeffX * v + coeffY * y[i]) / denom);
  },

  /**
   * Distance in B^n
   */
  distance(x, y) {
    const diff = x.map((v, i) => v - y[i]);
    const diffNorm = Math.sqrt(diff.reduce((s, v) => s + v * v, 0));

    // Compute |(-x) ⊕ y|
    const negX = x.map(v => -v);
    const mobResult = this.mobiusAdd(negX, y);
    const mobNorm = Math.sqrt(mobResult.reduce((s, v) => s + v * v, 0));

    return 2 * Math.atanh(Math.min(mobNorm, PROJ_CLAMP));
  },

  /**
   * Project n-dimensional point to 2D (first 2 coordinates)
   */
  projectTo2D(x) {
    return projC(x[0] || 0, x[1] || 0);
  },

  /**
   * Lift 2D point to n-dimensional (other coords = 0)
   */
  liftFrom2D(z, n = 8) {
    const result = new Float64Array(n);
    result[0] = z.re;
    result[1] = z.im;
    return result;
  }
};

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

window.HyperbolicProjections = {
  // Models
  PoincareDisk,
  KleinDisk,
  UpperHalfPlane,

  // Higher-dimensional
  PoincareBall,

  // Manager
  ProjectionManager,

  // Complex helpers
  C, cadd, csub, cmul, cdiv, cabs, cabs2, cscale, carg, cpolar, cconj
};

console.log('HyperbolicProjections loaded: Poincaré, Klein, and Half-Plane models');
