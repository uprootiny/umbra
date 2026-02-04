# Umbra Architecture: Mathematical Foundations & System Design

**Version:** 2.0
**Updated:** 2026-01-18
**Live:** https://umbra.hyperstitious.art

---

## I. Mathematical Foundations

### 1.1 The Poincaré Disk Model

The Poincaré disk is a conformal model of the hyperbolic plane H² realized as the open unit disk 𝔻 = {z ∈ ℂ : |z| < 1} equipped with the metric:

```
ds² = 4(dx² + dy²) / (1 - x² - y²)²
    = 4|dz|² / (1 - |z|²)²
```

This metric has constant Gaussian curvature K = -1. The conformal factor λ(z) = 2/(1 - |z|²) diverges as z approaches the boundary ∂𝔻, making the boundary "infinitely far" from any interior point.

**Key Properties:**
- Angles are preserved (conformal)
- Geodesics are circular arcs orthogonal to ∂𝔻, or diameters
- The boundary circle represents the "circle at infinity" (ideal points)
- Isometries are Möbius transformations preserving 𝔻

### 1.2 Hyperbolic Distance

For z, w ∈ 𝔻, the hyperbolic distance is:

```
d(z, w) = 2 arctanh |T_z(w)|

where T_z(w) = (w - z) / (1 - z̄w)
```

Equivalently:

```
d(z, w) = 2 arctanh ( |z - w| / |1 - z̄w| )

       = arccosh ( 1 + 2|z - w|² / ((1 - |z|²)(1 - |w|²)) )
```

The second form connects to the hyperboloid model via cosh(d).

**Numerical Implementation:**

```javascript
function hypDist(z, w) {
  // Guard: invalid inputs
  if (!isValidComplex(z) || !isValidComplex(w)) return Infinity;

  const diff = csub(z, w);
  if (cabs(diff) < EPSILON) return 0;  // Same point

  const num = cabs(diff);                        // |z - w|
  const den = cabs(csub(C(1,0), cmul(cconj(z), w)));  // |1 - z̄w|

  if (den < EPSILON) return Infinity;  // Denominator near zero

  const ratio = num / den;
  if (ratio >= 1) return Infinity;     // At or beyond boundary

  // Clamp for numerical stability near boundary
  const clampedRatio = Math.min(ratio, 0.99999);
  return 2 * Math.atanh(clampedRatio);
}
```

### 1.3 Möbius Transformations

The isometry group of (𝔻, ds²) is PSU(1,1), realized as Möbius transformations:

```
T_a(z) = (z - a) / (1 - āz)      (translation taking a ↦ 0)

T_a⁻¹(w) = (w + a) / (1 + āw)   (inverse: 0 ↦ a)
```

For a general isometry with rotation:

```
T(z) = e^{iθ} (z - a) / (1 - āz)
```

**Matrix representation in SU(1,1):**

```
T_a ↔ (1/√(1-|a|²)) [ 1   -a ]
                     [-ā   1 ]
```

The group PSU(1,1) = SU(1,1)/{±I} acts transitively on 𝔻 with point stabilizers isomorphic to SO(2).

**Decomposition:** Any isometry factors as:
1. Translation (boost) moving center
2. Rotation around new center

### 1.4 Geodesics

Geodesics in 𝔻 are:
- Diameters (through origin)
- Circular arcs meeting ∂𝔻 orthogonally

**Geodesic through z, w:**

```
Center: c = (z(1 + |w|²) - w(1 + |z|²)) / (z̄w - w̄z)   (if z̄w ≠ w̄z)
Radius: r = |z - c|
```

When z̄w = w̄z (collinear with origin), the geodesic is the diameter.

**Geodesic Interpolation (Lerp):**

To interpolate along the geodesic from z to w at parameter t ∈ [0,1]:

```javascript
function geodesicLerp(z, w, t) {
  if (t <= 0) return z;
  if (t >= 1) return w;

  // Total hyperbolic distance
  const d = hypDist(z, w);
  if (d < EPSILON) return z;
  if (d === Infinity) return z;

  // Target distance from z
  const targetDist = d * t;

  // Map z to origin, interpolate, map back
  const wAtOrigin = mobius(z, w);  // T_z(w)

  // Direction at origin
  const dir = cnorm(wAtOrigin);

  // New position: move targetDist along direction
  const r = Math.tanh(targetDist / 2);  // Poincaré radius for hyperbolic distance
  const clampedR = Math.min(r, 0.99999);

  const newPos = cscale(dir, clampedR);

  // Map back
  return mobiusInv(z, newPos);  // T_z⁻¹(newPos)
}
```

### 1.5 Hyperbolic Circles

A hyperbolic circle of radius ρ centered at a ∈ 𝔻 is:

```
{ z ∈ 𝔻 : d(z, a) = ρ }
```

This is a Euclidean circle with:

```
Euclidean center: c_e = a(1 - r²) / (1 - |a|²r²)

Euclidean radius: r_e = r(1 - |a|²) / (1 - |a|²r²)

where r = tanh(ρ/2)
```

When centered at origin (a = 0):
- Euclidean center = 0
- Euclidean radius = tanh(ρ/2)

### 1.6 Horocycles

A horocycle is a curve of constant "height" toward an ideal point ξ ∈ ∂𝔻. It's the limit of circles as center → ξ and radius → ∞.

In 𝔻, a horocycle appears as a Euclidean circle tangent to ∂𝔻 at ξ.

**Parametrization for ξ = 1:**

```
h(t) = (1 - e^{-s}) e^{it} + (1 - (1 - e^{-s}))
     = (1 - k) + k e^{it}

where k = 1 - e^{-s}, s is the "height" parameter
```

Horocycles are orthogonal to all geodesics terminating at ξ.

---

## II. The Lorentz/Hyperboloid Model

### 2.1 Minkowski Space ℝ^{n,1}

The hyperboloid model realizes H^n as a sheet of a hyperboloid in Minkowski space ℝ^{n,1}.

**Minkowski inner product:**

```
⟨x, y⟩_L = -x₀y₀ + x₁y₁ + x₂y₂ + ⋯ + xₙyₙ

         = -x₀y₀ + x⃗ · y⃗
```

**Hyperboloid:**

```
H^n = { x ∈ ℝ^{n,1} : ⟨x, x⟩_L = -1, x₀ > 0 }
```

This is the upper sheet of a two-sheeted hyperboloid.

### 2.2 Hyperbolic Distance in Lorentz Model

For points p, q ∈ H^n:

```
cosh(d(p, q)) = -⟨p, q⟩_L
```

Implementation for H^8 (9-dimensional Lorentz vectors):

```javascript
function lorentzDist(p, q) {
  // p, q are Float32Array of length 9
  let inner = -p[0] * q[0];  // Timelike component
  for (let i = 1; i < 9; i++) {
    inner += p[i] * q[i];    // Spacelike components
  }

  // Numerical guard: inner should be ≤ -1
  if (inner > -1) inner = -1;

  return Math.acosh(-inner);
}
```

### 2.3 Coordinate Conversions

**Poincaré Ball → Hyperboloid:**

For p ∈ B^n (Poincaré ball), the corresponding point on H^n is:

```
x₀ = (1 + |p|²) / (1 - |p|²)
xᵢ = 2pᵢ / (1 - |p|²)   for i = 1, ..., n
```

**Hyperboloid → Poincaré Ball:**

```
pᵢ = xᵢ / (1 + x₀)   for i = 1, ..., n
```

### 2.4 Lorentz Boosts

A Lorentz boost moves points along geodesics. The boost by velocity v in direction d̂ (unit spacelike vector):

```
B_v: H^n → H^n

B_v(x) = x + (cosh θ - 1)⟨x, d̂⟩_L d̂ + sinh θ ⟨x, d̂⟩_L e₀
       + sinh θ (x₀) d̂ + (cosh θ - 1)(x₀) e₀

where θ = arctanh(v)
```

More elegantly, using the exponential map:

```
B_v = exp(θ L_d)

where L_d is the generator for boosts in direction d.
```

### 2.5 Exponential and Logarithmic Maps

**Exponential map at p ∈ H^n:**

For tangent vector v ∈ T_p H^n (satisfying ⟨p, v⟩_L = 0):

```
exp_p(v) = cosh(|v|) p + sinh(|v|) (v / |v|)

where |v| = √⟨v, v⟩_L (Minkowski norm of spacelike v)
```

**Logarithmic map:**

```
log_p(q) = d(p,q) · (q - cosh(d) p) / sinh(d)

where d = d(p, q)
```

### 2.6 Parallel Transport

To transport a tangent vector v from p to q along the geodesic:

```
Π_{p→q}(v) = v - ⟨log_p(q), v⟩_L / d² · (log_p(q) + log_q(p))
```

This preserves the inner product: ⟨Π(v), Π(w)⟩ = ⟨v, w⟩.

**Holonomy:** For a closed loop γ, the parallel transport Π_γ is a rotation. The holonomy angle equals the enclosed area (Gauss-Bonnet):

```
θ = Area(γ) · |K| = Area(γ)   (since K = -1)
```

---

## III. The Klein Model

### 3.1 Definition

The Klein model (Beltrami-Klein model) represents H^n as the open unit ball with geodesics as straight chords.

**Metric:**

```
ds² = (dx² + dy²) / (1 - x² - y²) + (x dx + y dy)² / (1 - x² - y²)²
```

### 3.2 Conversions

**Poincaré → Klein:**

```
k = 2p / (1 + |p|²)
```

**Klein → Poincaré:**

```
p = k / (1 + √(1 - |k|²))
```

### 3.3 Advantages

- Geodesics are straight lines (simplifies intersection computations)
- Voronoi diagrams reduce to Euclidean constructions

### 3.4 Disadvantages

- Not conformal (angles distorted)
- Distance formula more complex

---

## IV. Geometric Constructions

### 4.1 Hyperbolic Voronoi Diagrams

The Voronoi cell of point pᵢ is:

```
V(pᵢ) = { x ∈ H² : d(x, pᵢ) ≤ d(x, pⱼ) ∀j ≠ i }
```

**Algorithm (Klein model):**
1. Convert points to Klein coordinates
2. Compute Euclidean Voronoi diagram
3. Clip cells to unit disk
4. Convert vertices back to Poincaré

The bisector between p and q in hyperbolic space becomes a chord in Klein model.

### 4.2 Hyperbolic Delaunay Triangulation

Dual to Voronoi: connect points whose Voronoi cells share an edge.

**Empty circle property:** A triangulation is Delaunay iff every triangle's circumcircle contains no other points (in hyperbolic metric).

### 4.3 Hyperbolic Convex Hulls

The convex hull of S ⊂ H² is the smallest convex set containing S, where "convex" means closed under geodesic segments.

**Algorithm:**
1. Map to Klein model (where convex = Euclidean convex)
2. Compute Euclidean convex hull
3. Map back to Poincaré

### 4.4 Tessellations

Regular {p, q} tilings satisfy:

```
(p - 2)(q - 2) > 4   ⟹   hyperbolic
(p - 2)(q - 2) = 4   ⟹   Euclidean (flat)
(p - 2)(q - 2) < 4   ⟹   spherical
```

**Hyperbolic tilings:** {7,3}, {5,4}, {3,7}, {4,5}, {8,3}, ...

**Generators for {p, q}:**
- Rotation by 2π/p about polygon center
- Rotation by 2π/q about a vertex

---

## V. Curvature and Defect

### 5.1 Geodesic Triangles

For a geodesic triangle with interior angles α, β, γ:

```
α + β + γ = π - Area

Area = π - α - β - γ   (always positive in H²)
```

The angle sum is always less than π.

### 5.2 Gauss-Bonnet Theorem

For a region R ⊂ H² with geodesic boundary:

```
∫∫_R K dA + ∫_∂R κ_g ds + Σ θᵢ = 2π χ(R)
```

With K = -1 and geodesic edges (κ_g = 0):

```
-Area(R) + Σ (π - αᵢ) = 2π χ(R)
```

For a triangle (χ = 1):

```
-Area + 3π - (α + β + γ) = 2π
Area = π - (α + β + γ)
```

---

## VI. System Architecture

### 6.1 Layer Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface                            │
│  hyperbolic-workspace-pro.html                                  │
│  ├── Canvas rendering (2D context)                              │
│  ├── Command palette (⌘K)                                       │
│  ├── Vim-style navigation (hjkl)                                │
│  ├── Gesture system (multi-pin, fold, witness)                  │
│  └── Settings panel                                             │
├─────────────────────────────────────────────────────────────────┤
│                     Visualization Engine                         │
│  hyperbolic-engine.js                                           │
│  ├── State management (viewCenter, zoom, focus)                 │
│  ├── Hit testing with spatial cache                             │
│  ├── Render pipeline with error boundary                        │
│  ├── Graph manipulation (add, delete, rename)                   │
│  └── Domain data (SPACES object: 6 semantic spaces)             │
├─────────────────────────────────────────────────────────────────┤
│                    Geometric Extensions                          │
│  geometry-extensions.js                                         │
│  ├── Klein model conversions                                    │
│  ├── Voronoi diagrams                                           │
│  ├── Parallel transport                                         │
│  └── Tessellation generation                                    │
├─────────────────────────────────────────────────────────────────┤
│                      Core Geometry                               │
│  lorentz-geometry.js                                            │
│  ├── Minkowski inner product                                    │
│  ├── Lorentz distance (cosh formulation)                        │
│  ├── Exponential/logarithmic maps                               │
│  ├── Boosts and rotations                                       │
│  ├── Ball tree spatial index                                    │
│  └── Level-of-detail computation                                │
├─────────────────────────────────────────────────────────────────┤
│                     Numerical Foundations                        │
│  (embedded in hyperbolic-engine.js)                             │
│  ├── Complex arithmetic (C, cadd, cmul, cdiv, cexp, clog)       │
│  ├── Möbius transforms (mobius, mobiusInv)                      │
│  ├── Hyperbolic distance (hypDist)                              │
│  ├── Geodesics (geodesicLerp, geodesicArc, sampleGeodesic)      │
│  ├── Circles and horocycles                                     │
│  └── Numerical guards (EPSILON, MAX_ATANH_ARG, clamping)        │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 State Machine

```
┌──────────┐   click    ┌──────────┐   F key   ┌──────────┐
│  Normal  │ ─────────▶ │ Selected │ ────────▶ │  Focus   │
└──────────┘            └──────────┘            └──────────┘
     │                       │                       │
     │ S key                 │ Esc                   │ Esc
     ▼                       ▼                       ▼
┌──────────┐            ┌──────────┐            ┌──────────┐
│  Select  │            │  Normal  │            │ Selected │
│  Mode    │            └──────────┘            └──────────┘
└──────────┘

Modes:
- Normal: navigate, click to select
- Select Mode (S): multi-select with click
- Focus Mode (F): drill into subtree
- Measure Mode (M): click two points for distance
```

### 6.3 Render Pipeline

```
requestAnimationFrame loop
         │
         ▼
  ┌──────────────────┐
  │ Error Boundary   │ ── catch errors ──▶ reset view after 5 failures
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Frame Rate Limit │ ── skip if < 16ms since last frame
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Apply Transforms │ ── viewCenter, zoom, focus
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Compute Visible  │ ── frustum culling via cabs2(z) < threshold
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Draw Grid        │ ── equidistant circles + radial geodesics
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Draw Edges       │ ── geodesic arcs with depth-based alpha
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Draw Nodes       │ ── circles with icons, depth coloring
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Draw Overlays    │ ── Voronoi, transport vectors, tilings
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Update Minimap   │ ── scaled copy with viewport indicator
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Update HUD       │ ── metrics, breadcrumb, selection badge
  └──────────────────┘
```

### 6.4 Spatial Indexing

**Ball Tree (Lorentz space):**

```
                    [root]
                   /      \
            [node_L]      [node_R]
             /    \        /    \
          [...]  [...]  [...]  [...]

Each node stores:
- center: Float32Array (Lorentz point)
- radius: number (hyperbolic radius of bounding ball)
- children: [left, right] or null (leaf)
- points: array of points (if leaf)
```

**Operations:**
- `knn(query, k)`: k nearest neighbors in O(log n) average
- `rangeSearch(query, radius)`: all points within radius

**Spatial Bucketing (2D Poincaré for force layout):**

```javascript
const BUCKET_SIZE = 0.1;

function buildSpatialIndex(nodes) {
  const buckets = new Map();
  for (const node of nodes) {
    const bx = Math.floor(node.z.re / BUCKET_SIZE);
    const by = Math.floor(node.z.im / BUCKET_SIZE);
    const key = `${bx},${by}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(node);
  }
  return buckets;
}

// Query: check only neighboring buckets (9 total for repulsion)
function nearbyNodes(z, buckets) {
  const bx = Math.floor(z.re / BUCKET_SIZE);
  const by = Math.floor(z.im / BUCKET_SIZE);
  const result = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${bx+dx},${by+dy}`;
      if (buckets.has(key)) result.push(...buckets.get(key));
    }
  }
  return result;
}
```

Reduces O(n²) force computation to O(n·k) where k ≈ average bucket density.

---

## VII. Domain Model

### 7.1 Six Semantic Spaces

```
SPACES = {
  studies:  { color: '#d2a8ff', icon: '📚', data: [...] },  // Academic
  infra:    { color: '#7ee787', icon: '🖥️', data: [...] },  // Infrastructure
  github:   { color: '#6eb5ff', icon: '🐙', data: [...] },  // Projects
  notes:    { color: '#ffb574', icon: '💡', data: [...] },  // Ideas
  math:     { color: '#ff9bce', icon: '∫',  data: [...] },  // Formal
  langs:    { color: '#c9a87c', icon: '𐤀', data: [...] },  // Languages
}
```

### 7.2 Node Structure

```javascript
{
  name: 'Möbius Transforms',
  icon: '🔄',                         // Optional emoji
  tags: ['core', 'umbra', 'live'],    // Metadata for filtering
  content: 'Isometric automorphisms of the Poincaré disk...',
  action: 'navigateTo',               // Optional action key
  data: { endpoint: '/api/...' },     // Optional action payload
  children: [...]                     // Nested hierarchy
}
```

### 7.3 Graph Representation

```javascript
{
  nodes: Map<string, {
    id: string,
    name: string,
    z: Complex,        // Position in Poincaré disk
    parent: string,    // Parent node ID
    depth: number,     // Distance from root
    lorentz: Float32Array  // H^8 coordinates (optional)
  }>,

  edges: Map<string, {
    source: string,
    target: string,
    type: 'parent' | 'sibling' | 'cross'
  }>
}
```

---

## VIII. Gestures & Interactions

### 8.1 Multi-Pin Clustering

Pin nodes as gravitational anchors, then run force-directed layout:

```
Force on node i:

F_i = Σ_j (attraction to pinned nodes)
    + Σ_k (repulsion from nearby nodes)
    + Σ_e (edge spring forces)

Update: z_i ← geodesicLerp(z_i, target, strength)
```

### 8.2 Fold/Unfold

Collapse selection into a single meta-node:

```javascript
function fold(graph, nodeIds, name) {
  const centroid = lorentzCentroid(nodeIds.map(id => graph.nodes.get(id).lorentz));
  const foldNode = {
    id: uuid(),
    name: name,
    icon: '◈',
    isFold: true,
    containedIds: nodeIds,
    originalPositions: new Map()  // Preserve for unfold
  };
  // Store relative positions, remove from view
}

function unfold(graph, foldId) {
  // Restore nodes at relative positions around fold location
}
```

### 8.3 Witness Cut

Ethical accountability before releasing focus:

```javascript
function witnessAndRelease() {
  const witness = {
    timestamp: Date.now(),
    focus: state.focus,
    selections: [...state.selected],
    pins: [...state.pins],
    depth: state.navigationDepth,
    viewCenter: { re: state.viewCenter.re, im: state.viewCenter.im }
  };

  // Prompt acknowledgment
  const acknowledged = confirm('Witness this session state before release?');

  if (acknowledged) {
    const witnesses = JSON.parse(localStorage.getItem('witnesses') || '[]');
    witnesses.push(witness);
    localStorage.setItem('witnesses', JSON.stringify(witnesses));
  }

  return acknowledged;
}
```

---

## IX. ClojureScript Integration Path

### 9.1 Philosophy

> "ClojureScript throughout, only yielding to JavaScript at the last necessary moment."

The mathematical core—complex arithmetic, Möbius transforms, hyperbolic distance—should be expressed in ClojureScript for:
- Immutable data structures (persistent vectors, maps)
- Functional composition
- REPL-driven development
- Spec for validation

### 9.2 Proposed Structure

```
umbra-cljs/
├── src/
│   ├── umbra/
│   │   ├── core.cljs           ; Entry point
│   │   ├── math/
│   │   │   ├── complex.cljs    ; Complex number operations
│   │   │   ├── mobius.cljs     ; Möbius transformations
│   │   │   ├── geodesic.cljs   ; Geodesic computations
│   │   │   ├── lorentz.cljs    ; Hyperboloid model
│   │   │   └── distance.cljs   ; Metric computations
│   │   ├── geometry/
│   │   │   ├── voronoi.cljs    ; Hyperbolic Voronoi
│   │   │   ├── klein.cljs      ; Klein model
│   │   │   ├── transport.cljs  ; Parallel transport
│   │   │   └── tiling.cljs     ; Regular tessellations
│   │   ├── graph/
│   │   │   ├── layout.cljs     ; Force-directed in H²
│   │   │   ├── spatial.cljs    ; Ball tree, bucketing
│   │   │   └── traverse.cljs   ; BFS, DFS, paths
│   │   ├── render/
│   │   │   ├── canvas.cljs     ; 2D canvas interop
│   │   │   ├── webgl.cljs      ; WebGL for H³
│   │   │   └── overlays.cljs   ; Voronoi, tilings
│   │   └── ui/
│   │       ├── events.cljs     ; Keyboard, mouse
│   │       ├── state.cljs      ; Reagent atoms
│   │       └── components.cljs ; Reagent components
│   └── hyle/
│       └── client.cljs         ; API client for Hyle server
├── deps.edn
├── shadow-cljs.edn
└── package.json
```

### 9.3 ClojureScript Complex Numbers

```clojure
(ns umbra.math.complex)

(defrecord Complex [re im])

(def EPSILON 1e-10)
(def MAX_ATANH_ARG 0.99999)

(defn c [re im] (->Complex re im))
(def origin (c 0 0))

(defn cabs2 [{:keys [re im]}]
  (+ (* re re) (* im im)))

(defn cabs [z]
  (Math/sqrt (cabs2 z)))

(defn cadd [{r1 :re i1 :im} {r2 :re i2 :im}]
  (c (+ r1 r2) (+ i1 i2)))

(defn csub [{r1 :re i1 :im} {r2 :re i2 :im}]
  (c (- r1 r2) (- i1 i2)))

(defn cmul [{r1 :re i1 :im} {r2 :re i2 :im}]
  (c (- (* r1 r2) (* i1 i2))
     (+ (* r1 i2) (* i1 r2))))

(defn cconj [{:keys [re im]}]
  (c re (- im)))

(defn cdiv [a b]
  (let [d (cabs2 b)]
    (if (< d (* EPSILON EPSILON))
      (let [r (cabs a)]
        (if (< r EPSILON)
          origin
          (cscale (cnorm a) 1e6)))
      (c (/ (+ (* (:re a) (:re b)) (* (:im a) (:im b))) d)
         (/ (- (* (:im a) (:re b)) (* (:re a) (:im b))) d)))))
```

### 9.4 ClojureScript Hyperbolic Distance

```clojure
(ns umbra.math.distance
  (:require [umbra.math.complex :as c :refer [c cabs csub cmul cconj]]))

(defn valid-complex? [z]
  (and z
       (js/isFinite (:re z))
       (js/isFinite (:im z))
       (not (js/isNaN (:re z)))
       (not (js/isNaN (:im z)))))

(defn hyp-dist
  "Hyperbolic distance in Poincaré disk: d(z,w) = 2·arctanh(|z-w|/|1-z̄w|)"
  [z w]
  (if-not (and (valid-complex? z) (valid-complex? w))
    js/Infinity
    (let [diff (csub z w)
          num (cabs diff)]
      (if (< num c/EPSILON)
        0
        (let [den (cabs (csub (c 1 0) (cmul (cconj z) w)))]
          (if (< den c/EPSILON)
            js/Infinity
            (let [ratio (/ num den)]
              (if (>= ratio 1)
                js/Infinity
                (let [clamped (min ratio c/MAX_ATANH_ARG)]
                  (* 2 (Math/atanh clamped)))))))))))
```

### 9.5 Hyle Integration

The Hyle server (ClojureScript backend) exposes NLP corpus analytics:

```clojure
(ns hyle.client
  (:require [cljs-http.client :as http]
            [cljs.core.async :refer [go <!]]))

(def base-url "http://localhost:8769")

(defn fetch-endpoint [endpoint]
  (go
    (let [response (<! (http/get (str base-url endpoint)))]
      (if (:success response)
        (:body response)
        (throw (ex-info "API error" response))))))

;; Corpus analytics
(defn zipf-distribution [] (fetch-endpoint "/api/hebrew/zipf"))
(defn heaps-law []        (fetch-endpoint "/api/linguistics/heaps"))
(defn ttr-curve []        (fetch-endpoint "/api/linguistics/ttr"))
(defn burstiness []       (fetch-endpoint "/api/linguistics/burstiness"))
```

---

## X. Vespers Playgrounds

Seven mathematical playgrounds, deployable at vespers.raindesk.dev:

| Playground | Lines | Purpose |
|------------|-------|---------|
| tensor.html | 910 | Einstein summation, tensor networks |
| hyperbolic.html | 1171 | Poincaré disk + Lorentz hyperboloid |
| attention.html | 940 | Transformer attention visualization |
| ga.html | 1333 | Conformal Geometric Algebra sandbox |
| proofs.html | 1178 | Proof tree composer (Lean/Coq export) |
| linguistics.html | 1201 | Semitic language family explorer |
| category-computation.html | 1422 | Homotopy Type Theory, six functors |

Each playground is standalone HTML/Canvas/JS, designed to integrate with Umbra nodes via URL navigation.

---

## XI. Deployment

### 11.1 File Manifest

```
umbra/
├── hyperbolic-workspace-pro.html   2534 lines  Main UI
├── hyperbolic-engine.js            5895 lines  Core engine
├── lorentz-geometry.js              733 lines  H^n math
├── geometry-extensions.js           666 lines  Voronoi, Klein, transport
├── playgrounds/                              7 standalone visualizations
├── scripts/
│   ├── deploy.sh                            Deployment automation
│   └── validate.sh                          Pre-deploy checks
└── docs/
    ├── ARCHITECTURE.md              (this)   Mathematical foundations
    ├── STATUS.md                            Implementation status
    ├── EXTENSIONS.md                        Geometry roadmap
    ├── LEDGER.md                            Capacity tracking
    └── DEPLOY.md                            Deployment procedures
```

### 11.2 Validation

```bash
./scripts/validate.sh

# Checks:
# - JavaScript syntax (node --check)
# - DOM element bindings (40 required IDs)
# - Domain definitions (6 spaces)
# - File sizes (engine > 3000 lines, etc.)
# - Script references in HTML
```

### 11.3 Deployment

```bash
# Dry run
./scripts/deploy.sh --umbra --dry-run

# Deploy to production
UMBRA_HOST=user@server ./scripts/deploy.sh --umbra

# Deploy both Umbra and Vespers
./scripts/deploy.sh --all
```

---

## XII. References

### 12.1 Hyperbolic Geometry

- Cannon, Floyd, Kenyon, Parry. "Hyperbolic Geometry." Flavors of Geometry (1997).
- Ratcliffe, J. "Foundations of Hyperbolic Manifolds." Springer (2006).
- Thurston, W. "The Geometry and Topology of Three-Manifolds." Princeton notes.

### 12.2 Lorentz Model

- Nickel, M. & Kiela, D. "Poincaré Embeddings for Learning Hierarchical Representations." NeurIPS (2017).
- Ganea, O. et al. "Hyperbolic Neural Networks." NeurIPS (2018).

### 12.3 Geometric Algebra

- Dorst, L., Fontijne, D., Mann, S. "Geometric Algebra for Computer Science." Morgan Kaufmann (2007).
- Hestenes, D. & Sobczyk, G. "Clifford Algebra to Geometric Calculus." Reidel (1984).

### 12.4 Conformal Maps

- Ahlfors, L. "Complex Analysis." McGraw-Hill (1979).
- Beardon, A. "The Geometry of Discrete Groups." Springer (1983).

---

*Generated 2026-01-18 for Umbra Hyperbolic Workspace*
