# Geometric Extensions Roadmap

## Current Geometric Capabilities

### Poincaré Disk Model (2D)
```
hyperbolic-engine.js
├── Complex arithmetic (C, cadd, cmul, cdiv, ...)
├── Möbius transformations (mobius, mobiusInv)
├── Hyperbolic distance (hypDist)
├── Geodesics (geodesicLerp, geodesicArc, sampleGeodesic)
├── Hyperbolic circles (hypCircle)
├── Horocycles (horocycle)
└── Midpoint computation (hypMidpoint)
```

### Lorentz/Hyperboloid Model (H^8 in R^9)
```
lorentz-geometry.js
├── Minkowski geometry (minkowskiInner, minkowskiNorm2)
├── Lorentz distance (lorentzDist, lorentzDistCosh)
├── Coordinate transforms (fromPoincareBall, toPoincareBall)
├── Boosts (lorentzBoost, lorentzBoostInv)
├── Exponential map (lorentzExp, lorentzLog)
├── Geodesic interpolation (lorentzGeodesicLerp, lorentzMidpoint)
├── Centroid computation (lorentzCentroid)
├── Rotations (lorentzRotate)
├── Ball tree spatial index (BallTreeNode)
└── LOD computation (computeLOD, isVisibleAtLOD)
```

---

## Extension Categories

### 1. GEOMETRIC PRIMITIVES

#### 1.1 Hyperbolic Voronoi Diagrams
**Complexity:** Medium
**Value:** High - natural clustering visualization

```
Current: None
Extension:
- hypVoronoiCell(center, neighbors) → polygon vertices
- hypVoronoiDiagram(points) → cells
- Uses geodesic bisectors instead of Euclidean
```

**Algorithm:**
- Compute hyperbolic perpendicular bisector between center and each neighbor
- Bisector is a geodesic equidistant from both points
- Intersect all bisectors to form cell

#### 1.2 Convex Hulls in H^n
**Complexity:** Medium
**Value:** Medium - boundary detection

```
Current: None
Extension:
- hypConvexHull(points) → geodesic polygon
- isInsideHypConvex(point, hull) → boolean
```

#### 1.3 Hyperbolic Triangulation
**Complexity:** Medium
**Value:** High - mesh generation for rendering

```
Current: None
Extension:
- hypDelaunay(points) → triangles
- hypTriangulate(polygon) → triangles
```

---

### 2. DIFFERENTIAL GEOMETRY

#### 2.1 Parallel Transport
**Complexity:** High
**Value:** High - vector field visualization, tangent space operations

```
Current: lorentzExp, lorentzLog (basic)
Extension:
- parallelTransport(vector, path) → transported vector
- holonomy(loop) → rotation angle
```

**Use cases:**
- Visualize how direction changes along paths
- Detect topological features
- Enable proper vector interpolation

#### 2.2 Curvature Visualization
**Complexity:** Medium
**Value:** Medium - educational, intuition building

```
Current: Implicit (constant K = -1)
Extension:
- visualizeCurvature(region) → heat map
- geodesicTriangleDefect(a, b, c) → angle sum - π
```

#### 2.3 Horospheres and Horoballs
**Complexity:** Low
**Value:** Medium - ideal point neighborhoods

```
Current: horocycle (2D only)
Extension:
- horosphere3D(idealDirection, radius) → surface
- horoball(idealDirection, size) → volume
```

---

### 3. TRANSFORMATION GROUPS

#### 3.1 Isometry Decomposition
**Complexity:** Medium
**Value:** High - animation, understanding transforms

```
Current: mobius (combined)
Extension:
- decomposeIsometry(M) → { rotation, translation, boost }
- animateIsometry(start, end, t) → interpolated transform
```

#### 3.2 Discrete Subgroups
**Complexity:** High
**Value:** Medium - tessellation patterns

```
Current: None
Extension:
- hyperbolicTiling(p, q) → {7,3}, {5,4}, etc.
- fundamentalDomain(group) → polygon
- orbitPoints(point, group, depth) → point cloud
```

#### 3.3 Limit Sets
**Complexity:** High
**Value:** Medium - fractals, boundary behavior

```
Current: None
Extension:
- limitSet(groupGenerators) → points on S^∞
- visualizeLimitSet(resolution) → bitmap
```

---

### 4. MULTI-MODEL INTEGRATION

#### 4.1 Klein Model
**Complexity:** Low
**Value:** Medium - straight geodesics for some computations

```
Current: None
Extension:
- toKlein(poincare) → klein coords
- fromKlein(klein) → poincare coords
- kleinGeodesic(a, b) → straight line segment
```

**Advantage:** Geodesics are straight lines (easier intersection)

#### 4.2 Half-Plane Model
**Complexity:** Low
**Value:** Low-Medium - alternative visualization

```
Current: None
Extension:
- toHalfPlane(poincare) → {x, y}
- fromHalfPlane(hp) → poincare
```

#### 4.3 Unified Interface
**Complexity:** Medium
**Value:** High - model-agnostic algorithms

```
interface HypPoint {
  toPoincare(): Complex
  toLorentz(): Float32Array
  toKlein(): [number, number]
  dist(other: HypPoint): number
}
```

---

### 5. HIGHER-DIMENSIONAL FEATURES

#### 5.1 H^3 Visualization
**Complexity:** High
**Value:** High - 3D immersive navigation

```
Current: H^8 backend, 2D projection only
Extension:
- render3DHyperbolic(scene, camera) → WebGL
- navigate3D(controls) → camera movement
- geodesicTube(path, radius) → 3D mesh
```

**Requirements:**
- WebGL/Three.js integration
- Proper fog/depth cues for hyperbolic distance
- 3D Möbius transformations

#### 5.2 Dimension Reduction for Visualization
**Complexity:** Medium
**Value:** High - see high-D structure in 2D

```
Current: Project first 2 dims only
Extension:
- hypMDS(points, targetDim) → low-dim embedding
- hypPCA(points) → principal geodesic analysis
- animateDimensionSlice(axis, t) → 2D slices through H^n
```

---

### 6. METRIC LEARNING

#### 6.1 Adaptive Curvature
**Complexity:** High
**Value:** High - fit geometry to data

```
Current: Fixed K = -1
Extension:
- learnCurvature(data, constraints) → optimal K
- variableCurvatureSpace(regions) → piecewise constant K
```

#### 6.2 Hyperbolic Embeddings
**Complexity:** Medium
**Value:** High - embed hierarchies optimally

```
Current: Manual tree layout
Extension:
- embedHierarchy(tree, options) → optimized positions
- hyperbolicMDS(distances) → embedding
- optimizeEmbedding(points, graph) → gradient descent
```

---

### 7. GRAPH-GEOMETRIC OPERATIONS

#### 7.1 Geometric Clustering
**Complexity:** Medium
**Value:** High - semantic grouping

```
Current: relayoutAroundPins (force-directed)
Extension:
- hypKMeans(points, k) → clusters
- hypDBSCAN(points, eps, minPts) → clusters
- hypHierarchicalCluster(points) → dendrogram
```

#### 7.2 Path Planning
**Complexity:** Medium
**Value:** Medium - navigation optimization

```
Current: Direct geodesics only
Extension:
- hypAStar(start, goal, obstacles) → path
- hypPathSmooth(path) → geodesic-like path
- visibilityGraph(obstacles) → graph
```

---

## Priority Matrix

| Extension | Complexity | Value | Dependencies | Priority | Status |
|-----------|------------|-------|--------------|----------|--------|
| Voronoi diagrams | Medium | High | None | P1 | ✅ DONE |
| Hyperbolic embeddings | Medium | High | None | P1 | ✅ DONE |
| Klein model | Low | Medium | None | P1 | ✅ DONE |
| Isometry decomposition | Medium | High | None | P2 | - |
| Dimension reduction | Medium | High | None | P2 | - |
| Triangulation | Medium | High | Voronoi | P2 | - |
| H^3 visualization | High | High | WebGL | P3 | - |
| Parallel transport | High | High | None | P3 | ✅ DONE |
| Discrete subgroups | High | Medium | None | P3 | ✅ DONE |
| Adaptive curvature | High | High | Embeddings | P4 | - |

### Implementation Details (P1/P3)

**geometry-extensions.js** provides:
- `poincareToKlein()`, `kleinToPoincare()` - coordinate transforms
- `hyperbolicVoronoiDiagram()` - Voronoi cells via Klein model
- `embedHierarchy()`, `optimizeEmbedding()` - hierarchy embedding
- `parallelTransport()`, `transportField()`, `holonomy()` - vector transport
- `tilingGenerators()`, `generateTiling()` - {p,q} hyperbolic tilings

**hyperbolic-engine.js** integrations:
- `drawVoronoiOverlay()` - renders hyperbolic Voronoi cells
- `drawTilingOverlay()` - renders {7,3} tessellation
- `drawTransportOverlay()` - renders parallel transport vectors along paths

Toggle via Settings > Geometric Overlays in the UI.

---

## Implementation Notes

### Code Organization
```
umbra/
├── lorentz-geometry.js      # Core H^n math
├── hyperbolic-engine.js     # Poincaré + rendering
├── geometry/                # NEW: Extension modules
│   ├── voronoi.js
│   ├── klein.js
│   ├── embeddings.js
│   ├── clustering.js
│   └── h3-render.js
```

### Testing Strategy
- Unit tests for each geometric primitive
- Visual tests comparing with known constructions
- Numerical stability tests near boundary
- Performance benchmarks for large point sets

### Compatibility
- All extensions should work with existing `Complex` type
- All extensions should have `Float32Array` Lorentz variants
- Rendering should be pluggable (2D canvas, WebGL)
