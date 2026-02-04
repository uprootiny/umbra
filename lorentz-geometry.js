/**
 * LORENTZ GEOMETRY MODULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hyperbolic geometry in the Lorentz/Hyperboloid model H^n ⊂ R^{n,1}
 * with CGA-inspired algebraic structure.
 *
 * The hyperboloid: ⟨x,x⟩_L = -1, x_0 > 0
 * Minkowski inner product: ⟨x,y⟩_L = -x_0·y_0 + Σ x_i·y_i
 *
 * DESIGN PRINCIPLES (from CGA):
 * - All transforms are versors (sandwich products)
 * - Points, geodesics, horospheres are algebraic objects
 * - Composition is multiplication
 * - Clean separation: geometry ↔ projection ↔ rendering
 *
 * EFFICIENCY:
 * - Float32Array for SIMD-friendly memory layout
 * - Prepared for ball tree spatial indexing
 * - LOD-aware distance calculations
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

const LORENTZ_DIM = 8;  // Working in H^8 (9-dimensional Minkowski space)
const LORENTZ_SIZE = LORENTZ_DIM + 1;

// ════════════════════════════════════════════════════════════════════════════
// LORENTZ POINT (on hyperboloid)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a Lorentz point at the origin of H^n
 * Origin: (1, 0, 0, ..., 0) - the "north pole" of the hyperboloid
 */
function lorentzOrigin() {
  const p = new Float32Array(LORENTZ_SIZE);
  p[0] = 1;  // x_0 = 1, rest = 0
  return p;
}

/**
 * Create a Lorentz point from Poincaré ball coordinates
 * Maps p ∈ B^n (|p| < 1) to hyperboloid
 *
 * x_0 = (1 + |p|²) / (1 - |p|²)
 * x_i = 2p_i / (1 - |p|²)
 */
function fromPoincareBall(ballCoords) {
  const p = new Float32Array(LORENTZ_SIZE);
  let r2 = 0;
  for (let i = 0; i < ballCoords.length && i < LORENTZ_DIM; i++) {
    r2 += ballCoords[i] * ballCoords[i];
  }

  // Compute scale factor if clamping needed (don't mutate input!)
  let scale = 1;
  if (r2 >= 0.9999) {
    scale = 0.999 / Math.sqrt(r2);
    r2 = 0.999 * 0.999;
  }

  const denom = 1 - r2;
  p[0] = (1 + r2) / denom;

  for (let i = 0; i < ballCoords.length && i < LORENTZ_DIM; i++) {
    p[i + 1] = 2 * ballCoords[i] * scale / denom;
  }

  return p;
}

/**
 * Convert Lorentz point back to Poincaré ball
 * p_i = x_i / (1 + x_0)
 */
function toPoincareBall(lorentzPoint) {
  const ball = new Float32Array(LORENTZ_DIM);
  const denom = 1 + lorentzPoint[0];

  for (let i = 0; i < LORENTZ_DIM; i++) {
    ball[i] = lorentzPoint[i + 1] / denom;
  }

  return ball;
}

/**
 * Project to 2D Poincaré disk (for current renderer compatibility)
 * Takes first 2 spatial dimensions
 */
function toPoincareDisk(lorentzPoint) {
  const denom = 1 + lorentzPoint[0];
  return {
    re: lorentzPoint[1] / denom,
    im: lorentzPoint[2] / denom
  };
}

/**
 * Lift 2D Poincaré disk point to Lorentz (for migration)
 */
function fromPoincareDisk(z) {
  if (!z || typeof z.re !== 'number' || typeof z.im !== 'number') {
    return fromPoincareBall([0, 0]);
  }
  return fromPoincareBall([z.re, z.im]);
}

// ════════════════════════════════════════════════════════════════════════════
// MINKOWSKI INNER PRODUCT & DISTANCE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Minkowski inner product: ⟨x,y⟩_L = -x_0·y_0 + Σ x_i·y_i
 */
function minkowskiInner(a, b) {
  let inner = -a[0] * b[0];
  for (let i = 1; i < LORENTZ_SIZE; i++) {
    inner += a[i] * b[i];
  }
  return inner;
}

/**
 * Minkowski norm squared: ⟨x,x⟩_L (should be -1 for points on hyperboloid)
 */
function minkowskiNorm2(x) {
  return minkowskiInner(x, x);
}

/**
 * Hyperbolic distance: d(a,b) = acosh(-⟨a,b⟩_L)
 */
function lorentzDist(a, b) {
  const inner = minkowskiInner(a, b);
  // inner should be ≤ -1 for points on hyperboloid
  // clamp for numerical stability
  return Math.acosh(Math.max(1, -inner));
}

/**
 * Fast distance check (avoids acosh for comparisons)
 * Returns -⟨a,b⟩_L which is cosh(d)
 * Larger value = greater distance
 */
function lorentzDistCosh(a, b) {
  return -minkowskiInner(a, b);
}

/**
 * Check if distance is less than threshold (without computing actual distance)
 */
function isCloserThan(a, b, maxDist) {
  const coshMax = Math.cosh(maxDist);
  return lorentzDistCosh(a, b) < coshMax;
}

// ════════════════════════════════════════════════════════════════════════════
// LORENTZ BOOST (TRANSLATION IN H^n)
// ════════════════════════════════════════════════════════════════════════════

/**
 * A Lorentz boost is the hyperbolic analog of translation.
 * Represented as a symmetric matrix that acts via matrix multiplication.
 *
 * Boost that moves origin to point p:
 * B_p = I + (outer product terms)
 *
 * For efficiency, we represent boosts implicitly and apply them directly.
 */

/**
 * Apply boost: move the origin to where 'center' is, then apply to 'point'
 * This is the Lorentz analog of Möbius transform T_a(z)
 *
 * Result: the point 'point' as seen from coordinate system centered at 'center'
 */
function lorentzBoost(center, point) {
  // Fast path: if center is origin, return point unchanged
  if (center[0] < 1.0001 && center[0] > 0.9999) {
    let isOrigin = true;
    for (let i = 1; i < LORENTZ_SIZE; i++) {
      if (Math.abs(center[i]) > 0.0001) {
        isOrigin = false;
        break;
      }
    }
    if (isOrigin) return point.slice();
  }

  // General boost using reflection formula
  // B_c(p) = -p + 2⟨c,p⟩_L · c + 2(c_0 + 1)(p - ⟨c,p⟩_L/(c_0+1) · c)
  // Simplified: this is equivalent to the Möbius transform in Poincaré

  const result = new Float32Array(LORENTZ_SIZE);
  const cp = minkowskiInner(center, point);
  const c0p1 = center[0] + 1;

  // Using the formula for boost in terms of center
  // This maps center -> origin and preserves hyperboloid
  const factor = (cp + 1) / c0p1;

  for (let i = 0; i < LORENTZ_SIZE; i++) {
    result[i] = point[i] - factor * center[i];
    if (i === 0) {
      result[i] += factor - 1;
    }
  }

  // Normalize to ensure we stay on hyperboloid
  return lorentzNormalize(result);
}

/**
 * Inverse boost: apply boost that moves 'center' back to origin
 */
function lorentzBoostInv(center, point) {
  // Inverse is just reflection: negate spatial part of center
  const negCenter = center.slice();
  for (let i = 1; i < LORENTZ_SIZE; i++) {
    negCenter[i] = -negCenter[i];
  }
  return lorentzBoost(negCenter, point);
}

/**
 * Normalize point to lie exactly on hyperboloid
 * Ensures ⟨x,x⟩_L = -1
 */
function lorentzNormalize(x) {
  const norm2 = minkowskiNorm2(x);
  if (Math.abs(norm2 + 1) < 0.0001) return x;

  // x_0 = sqrt(1 + |x_spatial|²)
  let spatialNorm2 = 0;
  for (let i = 1; i < LORENTZ_SIZE; i++) {
    spatialNorm2 += x[i] * x[i];
  }

  const result = x.slice();
  result[0] = Math.sqrt(1 + spatialNorm2);
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// GEODESIC INTERPOLATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Geodesic interpolation between two points
 * Uses the formula: γ(t) = cosh(t·d)·a + sinh(t·d)/sinh(d) · (b - cosh(d)·a)
 */
function lorentzGeodesicLerp(a, b, t) {
  if (t <= 0) return a.slice();
  if (t >= 1) return b.slice();

  const coshD = lorentzDistCosh(a, b);
  const d = Math.acosh(Math.max(1, coshD));

  if (d < 0.0001) return a.slice();

  const sinhD = Math.sinh(d);
  const td = t * d;
  const coshTd = Math.cosh(td);
  const sinhTd = Math.sinh(td);

  const result = new Float32Array(LORENTZ_SIZE);
  const factor = sinhTd / sinhD;

  for (let i = 0; i < LORENTZ_SIZE; i++) {
    result[i] = coshTd * a[i] + factor * (b[i] - coshD * a[i]);
  }

  return lorentzNormalize(result);
}

/**
 * Compute geodesic midpoint
 */
function lorentzMidpoint(a, b) {
  return lorentzGeodesicLerp(a, b, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// ROTATIONS (in spatial dimensions)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Apply rotation in the (i,j) plane by angle θ
 * This is a spatial rotation, doesn't touch x_0
 */
function lorentzRotate(point, i, j, theta) {
  const result = point.slice();
  const c = Math.cos(theta);
  const s = Math.sin(theta);

  // Rotate in plane (i+1, j+1) since index 0 is timelike
  const pi = point[i + 1];
  const pj = point[j + 1];

  result[i + 1] = c * pi - s * pj;
  result[j + 1] = s * pi + c * pj;

  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// TANGENT VECTORS & EXPONENTIAL MAP
// ════════════════════════════════════════════════════════════════════════════

/**
 * Exponential map at point p with tangent vector v
 * exp_p(v) = cosh(|v|)·p + sinh(|v|)/|v| · v
 *
 * v must be tangent to hyperboloid at p: ⟨p,v⟩_L = 0
 */
function lorentzExp(p, v) {
  // Tangent vector norm (positive, using Minkowski metric restricted to tangent space)
  let norm2 = 0;
  for (let i = 1; i < LORENTZ_SIZE; i++) {
    norm2 += v[i] * v[i];
  }
  norm2 -= v[0] * v[0];  // Minkowski, but for tangent vectors this should be positive

  // For tangent vectors at a point, the induced metric is Riemannian
  // Actually compute Euclidean norm of spatial part projected onto tangent space
  let spatialNorm2 = 0;
  for (let i = 1; i < LORENTZ_SIZE; i++) {
    spatialNorm2 += v[i] * v[i];
  }

  const norm = Math.sqrt(spatialNorm2);
  if (norm < 0.0001) return p.slice();

  const result = new Float32Array(LORENTZ_SIZE);
  const coshN = Math.cosh(norm);
  const sinhN = Math.sinh(norm);
  const factor = sinhN / norm;

  for (let i = 0; i < LORENTZ_SIZE; i++) {
    result[i] = coshN * p[i] + factor * v[i];
  }

  return lorentzNormalize(result);
}

/**
 * Log map: inverse of exp, gives tangent vector from p toward q
 * log_p(q) = d(p,q) / sinh(d(p,q)) · (q - cosh(d)·p)
 */
function lorentzLog(p, q) {
  const coshD = lorentzDistCosh(p, q);
  const d = Math.acosh(Math.max(1, coshD));

  if (d < 0.0001) {
    return new Float32Array(LORENTZ_SIZE);
  }

  const sinhD = Math.sinh(d);
  const factor = d / sinhD;

  const v = new Float32Array(LORENTZ_SIZE);
  for (let i = 0; i < LORENTZ_SIZE; i++) {
    v[i] = factor * (q[i] - coshD * p[i]);
  }

  return v;
}

// ════════════════════════════════════════════════════════════════════════════
// CENTROID (Fréchet mean)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Approximate hyperbolic centroid using iterative algorithm
 * Fréchet mean: argmin_c Σ d(c, p_i)²
 */
function lorentzCentroid(points, iterations = 5) {
  if (points.length === 0) return lorentzOrigin();
  if (points.length === 1) return points[0].slice();

  // Initialize with first point
  let centroid = points[0].slice();

  for (let iter = 0; iter < iterations; iter++) {
    // Compute mean tangent vector
    const meanTangent = new Float32Array(LORENTZ_SIZE);

    for (const p of points) {
      const v = lorentzLog(centroid, p);
      for (let i = 0; i < LORENTZ_SIZE; i++) {
        meanTangent[i] += v[i];
      }
    }

    // Scale by 1/n
    for (let i = 0; i < LORENTZ_SIZE; i++) {
      meanTangent[i] /= points.length;
    }

    // Step in direction of mean tangent
    centroid = lorentzExp(centroid, meanTangent);
  }

  return centroid;
}

// ════════════════════════════════════════════════════════════════════════════
// BALL TREE FOR SPATIAL INDEXING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hyperbolic ball tree node for efficient nearest-neighbor queries
 */
class LorentzBallTree {
  constructor(points, ids, leafSize = 10) {
    this.leafSize = leafSize;
    this.root = this._build(points, ids);
  }

  _build(points, ids) {
    if (points.length === 0) return null;

    if (points.length <= this.leafSize) {
      return {
        type: 'leaf',
        points,
        ids,
        center: lorentzCentroid(points, 3),
        radius: this._computeRadius(points)
      };
    }

    // Find dimension with largest spread
    const center = lorentzCentroid(points, 3);
    let maxSpread = 0;
    let splitDim = 1;

    for (let d = 1; d < LORENTZ_SIZE; d++) {
      let minV = Infinity, maxV = -Infinity;
      for (const p of points) {
        minV = Math.min(minV, p[d]);
        maxV = Math.max(maxV, p[d]);
      }
      const spread = maxV - minV;
      if (spread > maxSpread) {
        maxSpread = spread;
        splitDim = d;
      }
    }

    // Sort by split dimension and partition
    const indexed = points.map((p, i) => ({ point: p, id: ids[i], val: p[splitDim] }));
    indexed.sort((a, b) => a.val - b.val);

    const mid = Math.floor(indexed.length / 2);
    const leftPoints = indexed.slice(0, mid).map(x => x.point);
    const leftIds = indexed.slice(0, mid).map(x => x.id);
    const rightPoints = indexed.slice(mid).map(x => x.point);
    const rightIds = indexed.slice(mid).map(x => x.id);

    return {
      type: 'internal',
      center,
      radius: this._computeRadius(points),
      left: this._build(leftPoints, leftIds),
      right: this._build(rightPoints, rightIds)
    };
  }

  _computeRadius(points) {
    if (points.length === 0) return 0;
    const center = lorentzCentroid(points, 2);
    let maxDist = 0;
    for (const p of points) {
      maxDist = Math.max(maxDist, lorentzDist(center, p));
    }
    return maxDist;
  }

  /**
   * Find k nearest neighbors to query point
   */
  knn(query, k) {
    const heap = [];  // max-heap of {dist, id}

    const search = (node) => {
      if (!node) return;

      // Prune: if ball is farther than kth best, skip
      if (heap.length >= k) {
        const distToBall = lorentzDist(query, node.center) - node.radius;
        if (distToBall > heap[0].dist) return;
      }

      if (node.type === 'leaf') {
        for (let i = 0; i < node.points.length; i++) {
          const d = lorentzDist(query, node.points[i]);
          if (heap.length < k) {
            heap.push({ dist: d, id: node.ids[i] });
            this._heapifyUp(heap);
          } else if (d < heap[0].dist) {
            heap[0] = { dist: d, id: node.ids[i] };
            this._heapifyDown(heap);
          }
        }
      } else {
        // Visit closer child first
        const distLeft = node.left ? lorentzDist(query, node.left.center) : Infinity;
        const distRight = node.right ? lorentzDist(query, node.right.center) : Infinity;

        if (distLeft < distRight) {
          search(node.left);
          search(node.right);
        } else {
          search(node.right);
          search(node.left);
        }
      }
    };

    search(this.root);
    return heap.map(x => x.id);
  }

  /**
   * Find all points within distance r of query
   */
  rangeQuery(query, r) {
    const results = [];
    const coshR = Math.cosh(r);

    const search = (node) => {
      if (!node) return;

      // Prune: if ball doesn't intersect query ball, skip
      const distToCenter = lorentzDist(query, node.center);
      if (distToCenter - node.radius > r) return;

      if (node.type === 'leaf') {
        for (let i = 0; i < node.points.length; i++) {
          if (lorentzDistCosh(query, node.points[i]) < coshR) {
            results.push(node.ids[i]);
          }
        }
      } else {
        search(node.left);
        search(node.right);
      }
    };

    search(this.root);
    return results;
  }

  _heapifyUp(heap) {
    let i = heap.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (heap[parent].dist >= heap[i].dist) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  }

  _heapifyDown(heap) {
    let i = 0;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let largest = i;

      if (left < heap.length && heap[left].dist > heap[largest].dist) {
        largest = left;
      }
      if (right < heap.length && heap[right].dist > heap[largest].dist) {
        largest = right;
      }
      if (largest === i) break;

      [heap[i], heap[largest]] = [heap[largest], heap[i]];
      i = largest;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LOD (Level of Detail) SUPPORT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Compute LOD level based on hyperbolic distance from camera
 * Returns 0 (highest detail) to maxLOD (lowest detail)
 */
function computeLOD(cameraPoint, nodePoint, maxLOD = 4, detailRadius = 0.5) {
  const d = lorentzDist(cameraPoint, nodePoint);

  // Exponential falloff: each doubling of distance increases LOD by 1
  const lod = Math.floor(Math.log2(Math.max(1, d / detailRadius)));
  return Math.min(lod, maxLOD);
}

/**
 * Check if node should be visible at current LOD
 * Nodes with importance < LOD are culled
 */
function isVisibleAtLOD(nodeLOD, nodeImportance) {
  return nodeImportance >= nodeLOD;
}

// ════════════════════════════════════════════════════════════════════════════
// CGA-INSPIRED: MEET & JOIN OPERATIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * In true CGA, these would be wedge products.
 * Here we provide hyperbolic analogs:
 *
 * - "Line" through two points (geodesic)
 * - "Circle" equidistant from a point
 * - "Plane" perpendicular to a direction
 */

/**
 * Represent a geodesic (hyperbolic line) through two points
 * Stored as {a, b, direction} where direction is unit tangent at a toward b
 */
function geodesicThrough(a, b) {
  const direction = lorentzLog(a, b);
  let norm = 0;
  for (let i = 1; i < LORENTZ_SIZE; i++) {
    norm += direction[i] * direction[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0.0001) {
    for (let i = 0; i < LORENTZ_SIZE; i++) {
      direction[i] /= norm;
    }
  }

  return { a, b, direction, length: lorentzDist(a, b) };
}

/**
 * Sample points along a geodesic
 */
function sampleGeodesic(geodesic, numPoints = 32) {
  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    points.push(lorentzGeodesicLerp(geodesic.a, geodesic.b, t));
  }
  return points;
}

/**
 * Horosphere (limit of hyperbolic spheres, like a "plane at infinity")
 * Represented by its ideal point direction and a reference point
 */
function horosphere(idealDirection, referencePoint) {
  // Normalize the ideal direction (should be lightlike in limit)
  const dir = new Float32Array(LORENTZ_SIZE);
  let norm = 0;
  for (let i = 1; i < LORENTZ_SIZE; i++) {
    norm += idealDirection[i] * idealDirection[i];
  }
  norm = Math.sqrt(norm);
  dir[0] = 1;  // Lightlike: x_0 = |x_spatial|
  for (let i = 1; i < LORENTZ_SIZE; i++) {
    dir[i] = idealDirection[i] / norm;
  }

  return { direction: dir, reference: referencePoint };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════════════════════════════════════════

// Make available globally for integration
window.LorentzGeometry = {
  // Constants
  DIM: LORENTZ_DIM,
  SIZE: LORENTZ_SIZE,

  // Point creation
  origin: lorentzOrigin,
  fromPoincareBall,
  toPoincareBall,
  fromPoincareDisk,
  toPoincareDisk,

  // Metric
  minkowskiInner,
  minkowskiNorm2,
  dist: lorentzDist,
  distCosh: lorentzDistCosh,
  isCloserThan,

  // Transforms
  boost: lorentzBoost,
  boostInv: lorentzBoostInv,
  rotate: lorentzRotate,
  normalize: lorentzNormalize,

  // Geodesics
  geodesicLerp: lorentzGeodesicLerp,
  midpoint: lorentzMidpoint,
  exp: lorentzExp,
  log: lorentzLog,

  // Aggregates
  centroid: lorentzCentroid,

  // Spatial indexing
  BallTree: LorentzBallTree,

  // LOD
  computeLOD,
  isVisibleAtLOD,

  // Primitives
  geodesicThrough,
  sampleGeodesic,
  horosphere
};

console.log('LorentzGeometry loaded: H^' + LORENTZ_DIM + ' in R^' + LORENTZ_SIZE);
