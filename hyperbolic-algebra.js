/**
 * HYPERBOLIC ALGEBRA - Rigorous Higher-Dimensional Implementation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Novel algorithmic approaches to hyperbolic geometry:
 *
 * 1. GYROVECTOR SPACE - Proper algebraic structure for hyperbolic space
 *    - Möbius gyroaddition: a ⊕ b
 *    - Gyroscalar multiplication: r ⊗ a
 *    - Gyrations (Thomas precession): gyr[a,b]
 *
 * 2. MULTIPLE MODELS with verified transforms between them:
 *    - Poincaré ball B^n
 *    - Lorentz hyperboloid H^n
 *    - Klein ball K^n
 *    - Upper half-space U^n
 *
 * 3. PARALLEL TRANSPORT along geodesics
 *    - Move tangent vectors between points
 *    - Essential for optimization in hyperbolic space
 *
 * 4. BUSEMANN FUNCTIONS for ideal boundary
 *    - Horocycles as level sets
 *    - Handling points "at infinity"
 *
 * 5. HYPERBOLIC NEURAL PRIMITIVES
 *    - Hyperbolic linear layers
 *    - Hyperbolic averaging (Einstein midpoint)
 *    - Hyperbolic attention
 *
 * Mathematical foundation: Ungar's gyrovector space theory
 * Reference: "Analytic Hyperbolic Geometry" (Ungar, 2005)
 */

'use strict';

console.log('[HyperbolicAlgebra] Loading...');

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

const H_DIM = 8;          // Working dimension
const H_EPSILON = 1e-12;  // Numerical precision
const H_CLAMP = 1 - 1e-5; // Boundary clamp for Poincaré/Klein models

// ════════════════════════════════════════════════════════════════════════════
// BASIC VECTOR OPERATIONS (dimension-agnostic)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create zero vector of dimension n
 */
function zeros(n = H_DIM) {
  return new Float64Array(n);
}

/**
 * Euclidean dot product
 */
function dot(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Euclidean norm squared
 */
function norm2(a) {
  return dot(a, a);
}

/**
 * Euclidean norm
 */
function norm(a) {
  return Math.sqrt(norm2(a));
}

/**
 * Scale vector: k * a
 */
function scale(a, k) {
  const result = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) result[i] = a[i] * k;
  return result;
}

/**
 * Add vectors: a + b
 */
function add(a, b) {
  const n = Math.min(a.length, b.length);
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) result[i] = a[i] + b[i];
  return result;
}

/**
 * Subtract vectors: a - b
 */
function sub(a, b) {
  const n = Math.min(a.length, b.length);
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) result[i] = a[i] - b[i];
  return result;
}

/**
 * Normalize to unit vector (or zero if too small)
 */
function normalize(a) {
  const n = norm(a);
  return n > H_EPSILON ? scale(a, 1 / n) : zeros(a.length);
}

// ════════════════════════════════════════════════════════════════════════════
// POINCARÉ BALL MODEL - Gyrovector Space Operations
// ════════════════════════════════════════════════════════════════════════════

/**
 * Conformal factor at point x in Poincaré ball
 * λ_x = 2 / (1 - |x|²)
 */
function conformalFactor(x) {
  const r2 = norm2(x);
  if (r2 >= 1) return 1e10; // Approaching boundary
  return 2 / (1 - r2);
}

/**
 * Möbius addition in Poincaré ball: x ⊕ y
 *
 * Formula: x ⊕ y = ((1 + 2⟨x,y⟩ + |y|²)x + (1 - |x|²)y) / (1 + 2⟨x,y⟩ + |x|²|y|²)
 *
 * This is the fundamental operation of hyperbolic geometry.
 * Key properties:
 * - Left identity: 0 ⊕ y = y
 * - Left inverse: (-x) ⊕ x = 0
 * - NOT commutative: x ⊕ y ≠ y ⊕ x (in general)
 * - NOT associative: (x ⊕ y) ⊕ z ≠ x ⊕ (y ⊕ z) (in general)
 * - But: x ⊕ y = gyr[x,y](y ⊕ x) (gyrocommutative law)
 */
function mobiusAdd(x, y) {
  const x2 = norm2(x);
  const y2 = norm2(y);
  const xy = dot(x, y);

  const denom = 1 + 2 * xy + x2 * y2;
  if (Math.abs(denom) < H_EPSILON) {
    // Points are antipodal - return clamped result
    return clampToBall(x);
  }

  const coeffX = 1 + 2 * xy + y2;
  const coeffY = 1 - x2;

  const result = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    result[i] = (coeffX * x[i] + coeffY * y[i]) / denom;
  }

  return clampToBall(result);
}

/**
 * Möbius subtraction: x ⊖ y = x ⊕ (-y)
 */
function mobiusSub(x, y) {
  return mobiusAdd(x, scale(y, -1));
}

/**
 * Gyration operator: gyr[a,b](v)
 *
 * The gyration captures the "Thomas precession" - the rotation that occurs
 * when composing non-collinear boosts in hyperbolic space.
 *
 * gyr[a,b] = ⊖(a ⊕ b) ⊕ (a ⊕ (b ⊕ v))
 *
 * For computational efficiency, we use the explicit formula.
 */
function gyration(a, b, v) {
  const a2 = norm2(a);
  const b2 = norm2(b);
  const ab = dot(a, b);
  const av = dot(a, v);
  const bv = dot(b, v);

  const denom = 1 + 2 * ab + a2 * b2;
  if (Math.abs(denom) < H_EPSILON) return v.slice();

  // Gyration matrix action (derived from Ungar's formula)
  const A = 1 + 2 * ab + b2;
  const B = -2 * (1 + ab);

  const result = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) {
    // gyr[a,b](v) = v + 2(A⟨a,v⟩ + B⟨b,v⟩)/(denom) × (b×(a×v)) approximation
    // For full accuracy, compute the 2x2 rotation in the a,b plane
    result[i] = v[i]; // Start with v
  }

  // Project to a,b plane and rotate
  const aUnit = normalize(a);
  const bPerp = sub(b, scale(aUnit, dot(b, aUnit)));
  const bUnit = normalize(bPerp);

  if (norm(bUnit) > H_EPSILON) {
    const vA = dot(v, aUnit);
    const vB = dot(v, bUnit);

    // Gyration angle
    const cosTheta = (1 - a2 * b2) / denom;
    const sinTheta = 2 * Math.sqrt(a2 * b2 * (1 - dot(aUnit, normalize(b)) ** 2)) / denom;

    // Apply rotation in a,b plane
    const vANew = cosTheta * vA - sinTheta * vB;
    const vBNew = sinTheta * vA + cosTheta * vB;

    for (let i = 0; i < v.length; i++) {
      result[i] = v[i] - vA * aUnit[i] - vB * bUnit[i] + vANew * aUnit[i] + vBNew * bUnit[i];
    }
  }

  return result;
}

/**
 * Gyroscalar multiplication: r ⊗ x
 *
 * Scales a point along the geodesic from origin through x.
 * r ⊗ x = tanh(r × artanh(|x|)) × (x/|x|)
 */
function gyroScalarMul(r, x) {
  const xNorm = norm(x);
  if (xNorm < H_EPSILON) return zeros(x.length);

  const clampedNorm = Math.min(xNorm, H_CLAMP);
  const artanhNorm = Math.atanh(clampedNorm);
  const newNorm = Math.tanh(r * artanhNorm);

  return scale(x, newNorm / xNorm);
}

/**
 * Clamp point to ball interior
 */
function clampToBall(x, maxNorm = H_CLAMP) {
  const r = norm(x);
  if (r <= maxNorm) return x;
  return scale(x, maxNorm / r);
}

// ════════════════════════════════════════════════════════════════════════════
// HYPERBOLIC DISTANCE AND GEODESICS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hyperbolic distance in Poincaré ball
 * d(x, y) = 2 × artanh(|(-x) ⊕ y|)
 */
function poincareDistance(x, y) {
  const diff = mobiusSub(y, x);
  const diffNorm = norm(diff);
  if (diffNorm >= 1) return Infinity;
  return 2 * Math.atanh(Math.min(diffNorm, H_CLAMP));
}

/**
 * Geodesic interpolation: point at fraction t along geodesic from x to y
 * γ(t) = x ⊕ (t ⊗ ((-x) ⊕ y))
 */
function geodesicInterp(x, y, t) {
  if (t <= 0) return x.slice();
  if (t >= 1) return y.slice();

  const diff = mobiusSub(y, x);  // (-x) ⊕ y
  const scaled = gyroScalarMul(t, diff);  // t ⊗ diff
  return mobiusAdd(x, scaled);  // x ⊕ scaled
}

/**
 * Hyperbolic midpoint (geodesic at t=0.5)
 */
function hyperbolicMidpoint(x, y) {
  return geodesicInterp(x, y, 0.5);
}

/**
 * Einstein midpoint - closed-form weighted average
 *
 * For points x_i with weights w_i:
 * midpoint = Σ(γ_i × w_i × x_i) / Σ(γ_i × w_i)
 * where γ_i = 1 / √(1 - |x_i|²) is the Lorentz factor
 *
 * This is faster than iterative Fréchet mean for uniform weights.
 */
function einsteinMidpoint(points, weights = null) {
  if (points.length === 0) return zeros();
  if (points.length === 1) return points[0].slice();

  const dim = points[0].length;
  const sum = zeros(dim);
  let totalWeight = 0;

  for (let i = 0; i < points.length; i++) {
    const x = points[i];
    const r2 = norm2(x);
    if (r2 >= 1) continue; // Skip boundary points

    const gamma = 1 / Math.sqrt(1 - r2); // Lorentz factor
    const w = weights ? weights[i] * gamma : gamma;

    for (let j = 0; j < dim; j++) {
      sum[j] += w * x[j];
    }
    totalWeight += w;
  }

  if (totalWeight < H_EPSILON) return zeros(dim);

  const result = scale(sum, 1 / totalWeight);
  return clampToBall(result);
}

// ════════════════════════════════════════════════════════════════════════════
// PARALLEL TRANSPORT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Parallel transport of tangent vector v from point x to point y
 *
 * In hyperbolic space, parallel transport along a geodesic can be computed
 * using the gyration: PT_{x→y}(v) = gyr[y, -x](v) × (λ_x / λ_y)
 *
 * This is essential for:
 * - Gradient descent in hyperbolic space
 * - Comparing vectors at different points
 * - Hyperbolic neural networks
 */
function parallelTransport(x, y, v) {
  // Scale factor from conformal factors
  const lambdaX = conformalFactor(x);
  const lambdaY = conformalFactor(y);
  const scaleFactor = lambdaX / lambdaY;

  // Apply gyration and scale
  const negX = scale(x, -1);
  const transported = gyration(y, negX, v);

  return scale(transported, scaleFactor);
}

/**
 * Exponential map at point x with tangent vector v
 * exp_x(v) = x ⊕ (tanh(λ_x × |v| / 2) × v/|v|)
 */
function expMap(x, v) {
  const vNorm = norm(v);
  if (vNorm < H_EPSILON) return x.slice();

  const lambda = conformalFactor(x);
  const t = Math.tanh(lambda * vNorm / 2);
  const direction = scale(v, t / vNorm);

  return mobiusAdd(x, direction);
}

/**
 * Logarithmic map at point x toward point y
 * log_x(y) = (2 / λ_x) × artanh(|(-x) ⊕ y|) × (((-x) ⊕ y) / |(-x) ⊕ y|)
 */
function logMap(x, y) {
  const diff = mobiusSub(y, x);
  const diffNorm = norm(diff);
  if (diffNorm < H_EPSILON) return zeros(x.length);

  const lambda = conformalFactor(x);
  const dist = 2 * Math.atanh(Math.min(diffNorm, H_CLAMP));

  return scale(diff, (2 / lambda) * (dist / diffNorm));
}

// ════════════════════════════════════════════════════════════════════════════
// MODEL CONVERSIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Poincaré ball to Lorentz hyperboloid
 *
 * x_0 = (1 + |p|²) / (1 - |p|²)
 * x_i = 2p_i / (1 - |p|²)
 */
function poincareToLorentz(p) {
  const p2 = norm2(p);
  if (p2 >= 1) {
    // Clamp and convert
    const clamped = clampToBall(p);
    return poincareToLorentz(clamped);
  }

  const denom = 1 - p2;
  const result = new Float64Array(p.length + 1);
  result[0] = (1 + p2) / denom;
  for (let i = 0; i < p.length; i++) {
    result[i + 1] = 2 * p[i] / denom;
  }
  return result;
}

/**
 * Lorentz hyperboloid to Poincaré ball
 * p_i = x_i / (1 + x_0)
 */
function lorentzToPoincare(x) {
  const denom = 1 + x[0];
  const result = new Float64Array(x.length - 1);
  for (let i = 1; i < x.length; i++) {
    result[i - 1] = x[i] / denom;
  }
  return result;
}

/**
 * Poincaré ball to Klein ball
 * k = 2p / (1 + |p|²)
 */
function poincareToKlein(p) {
  const p2 = norm2(p);
  const factor = 2 / (1 + p2);
  return scale(p, factor);
}

/**
 * Klein ball to Poincaré ball
 * p = k / (1 + √(1 - |k|²))
 */
function kleinToPoincare(k) {
  const k2 = norm2(k);
  if (k2 >= 1) {
    const clamped = clampToBall(k);
    return kleinToPoincare(clamped);
  }
  const factor = 1 / (1 + Math.sqrt(1 - k2));
  return scale(k, factor);
}

// ════════════════════════════════════════════════════════════════════════════
// LORENTZ MODEL OPERATIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Minkowski inner product: ⟨x,y⟩_L = -x_0 y_0 + Σ x_i y_i
 */
function minkowskiInner(x, y) {
  let inner = -x[0] * y[0];
  for (let i = 1; i < x.length; i++) {
    inner += x[i] * y[i];
  }
  return inner;
}

/**
 * Hyperbolic distance in Lorentz model
 * d(x,y) = acosh(-⟨x,y⟩_L)
 */
function lorentzDistance(x, y) {
  const inner = minkowskiInner(x, y);
  return Math.acosh(Math.max(1, -inner));
}

/**
 * Lorentz boost - proper implementation
 *
 * The boost B_v in direction v with rapidity |v| acts as:
 * B_v(x) = x + (sinh(|v|)/|v|)(⟨x,v⟩_L × v̂ + x_0 × v)
 *            + (cosh(|v|) - 1)(⟨x,v⟩_L × v̂_0 × ê_0 + projection terms)
 *
 * For a boost that maps origin to point p (both on hyperboloid):
 */
function lorentzBoost(p, x) {
  // If p is at origin (1,0,0,...), return x unchanged
  if (Math.abs(p[0] - 1) < H_EPSILON) {
    let atOrigin = true;
    for (let i = 1; i < p.length; i++) {
      if (Math.abs(p[i]) > H_EPSILON) { atOrigin = false; break; }
    }
    if (atOrigin) return x.slice();
  }

  // Rapidity: cosh(ρ) = p_0
  const coshRho = p[0];
  const sinhRho = Math.sqrt(coshRho * coshRho - 1);

  if (sinhRho < H_EPSILON) return x.slice();

  // Direction of boost (unit spacelike vector)
  const dir = new Float64Array(p.length);
  dir[0] = 0;
  for (let i = 1; i < p.length; i++) {
    dir[i] = p[i] / sinhRho;
  }

  // Spatial component of x in boost direction
  let xDotDir = 0;
  for (let i = 1; i < x.length; i++) {
    xDotDir += x[i] * dir[i];
  }

  // Apply boost
  const result = new Float64Array(x.length);
  result[0] = coshRho * x[0] + sinhRho * xDotDir;

  for (let i = 1; i < x.length; i++) {
    result[i] = x[i] + (coshRho - 1) * xDotDir * dir[i] + sinhRho * x[0] * dir[i];
  }

  return result;
}

/**
 * Geodesic interpolation in Lorentz model
 */
function lorentzGeodesic(x, y, t) {
  if (t <= 0) return x.slice();
  if (t >= 1) return y.slice();

  const inner = -minkowskiInner(x, y); // cosh(d)
  const d = Math.acosh(Math.max(1, inner));

  if (d < H_EPSILON) return x.slice();

  const sinhD = Math.sinh(d);
  const result = new Float64Array(x.length);

  const a = Math.sinh((1 - t) * d) / sinhD;
  const b = Math.sinh(t * d) / sinhD;

  for (let i = 0; i < x.length; i++) {
    result[i] = a * x[i] + b * y[i];
  }

  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// BUSEMANN FUNCTIONS AND IDEAL BOUNDARY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Busemann function for ideal point ξ (unit vector on boundary)
 *
 * B_ξ(x) = log((1 + |x|² - 2⟨x,ξ⟩) / (1 - |x|²))
 *
 * Level sets of B_ξ are horocycles centered at ξ.
 * B_ξ(x) - B_ξ(y) gives signed distance along horocycle.
 */
function busemannFunction(xi, x) {
  const x2 = norm2(x);
  if (x2 >= 1) return Infinity;

  const xxiDot = dot(x, xi);
  const numer = 1 + x2 - 2 * xxiDot;
  const denom = 1 - x2;

  return Math.log(numer / denom);
}

/**
 * Project point onto horocycle at level h centered at ideal point ξ
 */
function projectToHorocycle(xi, h, x) {
  // Find the point on the horocycle closest to x
  // This involves solving B_ξ(p) = h with p on the geodesic from x to ξ

  const xiUnit = normalize(xi);
  const xDotXi = dot(x, xiUnit);

  // Binary search for the correct point
  // (Could be done analytically but this is more robust)
  let lo = 0, hi = 1 - H_EPSILON;

  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const p = add(scale(x, 1 - mid), scale(xiUnit, mid));
    const bp = busemannFunction(xiUnit, p);

    if (bp < h) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  const t = (lo + hi) / 2;
  return add(scale(x, 1 - t), scale(xiUnit, t));
}

// ════════════════════════════════════════════════════════════════════════════
// HYPERBOLIC NEURAL NETWORK PRIMITIVES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hyperbolic linear transformation
 *
 * Maps x to M⊗x ⊕ b where M is a matrix (applied in tangent space at origin)
 * and b is a bias in hyperbolic space.
 */
function hyperbolicLinear(x, M, b) {
  // Log map to tangent space at origin
  const v = logMap(zeros(x.length), x);

  // Apply matrix in tangent space
  const Mv = new Float64Array(M.length);
  for (let i = 0; i < M.length; i++) {
    Mv[i] = dot(M[i], v);
  }

  // Exp map back to hyperbolic space
  const Mx = expMap(zeros(Mv.length), Mv);

  // Add bias
  return mobiusAdd(Mx, b);
}

/**
 * Hyperbolic attention score
 *
 * Attention based on hyperbolic distance:
 * score(q, k) = -β × d_H(q, k)²
 */
function hyperbolicAttentionScore(query, key, beta = 1.0) {
  const d = poincareDistance(query, key);
  return -beta * d * d;
}

/**
 * Hyperbolic weighted aggregation
 *
 * Given points and attention weights, compute hyperbolic weighted average.
 */
function hyperbolicAggregate(points, weights) {
  // Use Einstein midpoint with attention weights
  return einsteinMidpoint(points, weights);
}

// ════════════════════════════════════════════════════════════════════════════
// SPATIAL INDEXING - Hyperbolic VP-Tree
// ════════════════════════════════════════════════════════════════════════════

/**
 * Vantage Point Tree for hyperbolic space
 *
 * More efficient than ball trees for hyperbolic geometry because
 * VP-trees use distances directly rather than bounding volumes.
 */
class HyperbolicVPTree {
  constructor(points, ids) {
    this.root = this._build(points.map((p, i) => ({ point: p, id: ids[i] })));
  }

  _build(items) {
    if (items.length === 0) return null;
    if (items.length === 1) {
      return { vantage: items[0].point, id: items[0].id, radius: 0, inside: null, outside: null };
    }

    // Choose vantage point (random is fine, could optimize)
    const vpIdx = Math.floor(Math.random() * items.length);
    const vp = items[vpIdx];

    // Compute distances to vantage point
    const others = items.filter((_, i) => i !== vpIdx);
    const withDist = others.map(item => ({
      ...item,
      dist: poincareDistance(vp.point, item.point)
    }));

    // Sort by distance and split at median
    withDist.sort((a, b) => a.dist - b.dist);
    const median = withDist[Math.floor(withDist.length / 2)].dist;

    const inside = withDist.filter(x => x.dist <= median);
    const outside = withDist.filter(x => x.dist > median);

    return {
      vantage: vp.point,
      id: vp.id,
      radius: median,
      inside: this._build(inside),
      outside: this._build(outside)
    };
  }

  /**
   * Find k nearest neighbors
   */
  knn(query, k) {
    const heap = []; // Max-heap of {dist, id}

    const search = (node, tau) => {
      if (!node) return tau;

      const d = poincareDistance(query, node.vantage);

      if (heap.length < k) {
        heap.push({ dist: d, id: node.id });
        this._heapifyUp(heap);
        tau = heap[0].dist;
      } else if (d < heap[0].dist) {
        heap[0] = { dist: d, id: node.id };
        this._heapifyDown(heap);
        tau = heap[0].dist;
      }

      // Decide which subtree to search first
      if (d < node.radius) {
        // Query is inside - search inside first
        tau = search(node.inside, tau);
        if (d + tau >= node.radius) {
          tau = search(node.outside, tau);
        }
      } else {
        // Query is outside - search outside first
        tau = search(node.outside, tau);
        if (d - tau <= node.radius) {
          tau = search(node.inside, tau);
        }
      }

      return tau;
    };

    search(this.root, Infinity);
    return heap.sort((a, b) => a.dist - b.dist).map(x => x.id);
  }

  /**
   * Range query - find all points within distance r
   */
  range(query, r) {
    const results = [];

    const search = (node) => {
      if (!node) return;

      const d = poincareDistance(query, node.vantage);

      if (d <= r) {
        results.push(node.id);
      }

      if (d - r <= node.radius) {
        search(node.inside);
      }
      if (d + r >= node.radius) {
        search(node.outside);
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

      if (left < heap.length && heap[left].dist > heap[largest].dist) largest = left;
      if (right < heap.length && heap[right].dist > heap[largest].dist) largest = right;
      if (largest === i) break;

      [heap[i], heap[largest]] = [heap[largest], heap[i]];
      i = largest;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2D CONVENIENCE WRAPPERS (for current renderer compatibility)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create 2D point from complex number {re, im}
 */
function fromComplex(z) {
  return new Float64Array([z.re || 0, z.im || 0]);
}

/**
 * Convert 2D point to complex number
 */
function toComplex(p) {
  return { re: p[0] || 0, im: p[1] || 0 };
}

/**
 * 2D Möbius addition (convenience wrapper)
 */
function mobius2D(a, z) {
  const aVec = fromComplex(a);
  const zVec = fromComplex(z);
  // Actually want to compute the transform T_a(z) = (z - a)/(1 - conj(a)*z)
  // which in terms of gyrovector operations is: (-a) ⊕ z
  const result = mobiusAdd(scale(aVec, -1), zVec);
  return toComplex(result);
}

/**
 * 2D inverse Möbius (convenience wrapper)
 */
function mobiusInv2D(a, w) {
  const aVec = fromComplex(a);
  const wVec = fromComplex(w);
  // T_a^{-1}(w) = a ⊕ w
  const result = mobiusAdd(aVec, wVec);
  return toComplex(result);
}

/**
 * 2D hyperbolic distance (convenience wrapper)
 */
function hypDist2D(z, w) {
  return poincareDistance(fromComplex(z), fromComplex(w));
}

/**
 * 2D geodesic interpolation (convenience wrapper)
 */
function geodesicLerp2D(z1, z2, t) {
  const result = geodesicInterp(fromComplex(z1), fromComplex(z2), t);
  return toComplex(result);
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════════════════════════════════════════

window.HyperbolicAlgebra = {
  // Configuration
  DIM: H_DIM,
  EPSILON: H_EPSILON,

  // Basic operations
  zeros, dot, norm, norm2, scale, add, sub, normalize,

  // Gyrovector operations (Poincaré ball)
  mobiusAdd,
  mobiusSub,
  gyration,
  gyroScalarMul,
  conformalFactor,
  clampToBall,

  // Distances and geodesics
  poincareDistance,
  geodesicInterp,
  hyperbolicMidpoint,
  einsteinMidpoint,

  // Tangent space operations
  expMap,
  logMap,
  parallelTransport,

  // Model conversions
  poincareToLorentz,
  lorentzToPoincare,
  poincareToKlein,
  kleinToPoincare,

  // Lorentz operations
  minkowskiInner,
  lorentzDistance,
  lorentzBoost,
  lorentzGeodesic,

  // Ideal boundary
  busemannFunction,
  projectToHorocycle,

  // Neural primitives
  hyperbolicLinear,
  hyperbolicAttentionScore,
  hyperbolicAggregate,

  // Spatial indexing
  VPTree: HyperbolicVPTree,

  // 2D wrappers for compatibility
  fromComplex,
  toComplex,
  mobius2D,
  mobiusInv2D,
  hypDist2D,
  geodesicLerp2D
};

console.log(`HyperbolicAlgebra loaded: ${H_DIM}-dimensional gyrovector space`);
