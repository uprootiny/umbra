# Umbra Hyperbolic Workspace - Status & Architecture

**Live at:** https://umbra.hyperstitious.art
**TLS:** Let's Encrypt (auto-renewed by Caddy)
**Deployment:** `./deploy.sh status`

---

## Current State Assessment

### Core Geometry (Working)

The Poincare disk model implementation is mathematically correct:

| Component | Status | Lines | Notes |
|-----------|--------|-------|-------|
| Complex arithmetic | OK | 34-56 | Full library: add, mul, div, exp, log, polar |
| Mobius transforms | OK | 93-102 | T_a(z) = (z-a)/(1-conj(a)z) and inverse |
| Hyperbolic distance | OK | 108-113 | d(z,w) = 2*arctanh(\|mobius(z,w)\|) |
| Geodesic interpolation | OK | 125-139 | tanh-space interpolation respects metric |
| Geodesic arc rendering | OK | 145-164 | Circular arcs perpendicular to boundary |
| Hyperbolic circles | OK | 180-190 | eucRadius = tanh(hypRadius/2) |
| Horocycles | OK | 195-206 | Limit circles tangent to boundary |
| Grid visualization | OK | 816-842 | Equidistant curves + radial geodesics |

### Navigation & Interaction (Working)

| Feature | Status | Notes |
|---------|--------|-------|
| Pan with momentum | OK | Drag + physics with friction |
| Zoom (wheel + keys) | OK | +/- keys, mouse wheel |
| Focus node | OK | Click or command palette |
| History back/forward | OK | Cmd+[ and Cmd+] |
| Space switching | OK | 1-4 keys for 4 spaces |
| Path measurement | OK | M mode, shows hyperbolic distance |
| Multi-select | OK | S mode + Ctrl/Cmd+click |
| Context menu | OK | Right-click on nodes |
| Command palette | OK | Cmd+K with fuzzy search |
| Keyboard shortcuts | OK | Full vim-style navigation |

### UI Features (Partial/Broken)

| Feature | Status | Issue |
|---------|--------|-------|
| Minimap | PARTIAL | Display only - no interaction |
| "Show all" button | BROKEN | No handler attached |
| Cluster manipulation | MISSING | No code exists |
| Node creation | MISSING | Tab/Space/Return not implemented |
| Content editing | MISSING | Details panel shows properties only |
| Escape hierarchy | PARTIAL | Only closes modals, doesn't exit focus mode |
| Depth legend tweak | MISSING | No palette adjustment UI |
| Perspective nodes | MISSING | Not implemented |
| Multiple minimaps | MISSING | Single fixed minimap |

---

## Geometry Extensions

### 1. Alternative 2D Projections for Minimaps

Each minimap could show a different model of hyperbolic geometry:

```
Poincare Disk          Klein Disk             Half-Plane
    ○                      ○                     |
   /|\                    /|\                    |
  / | \                  / | \                   |  /
 /  |  \                /  |  \                  | /
○───○───○              ○───○───○                 |/___
 \  |  /                \  |  /
  \ | /                  \ | /                   Boundary
   \|/                    \|/                    at infinity
    ○                      ○
                      (straight geodesics)
```

**Poincare Disk** (current): Conformal (preserves angles), geodesics are circular arcs.

**Klein Disk**: Geodesics are straight lines, but angles are distorted. Better for seeing graph structure.

**Poincare Half-Plane**: Infinite vertical extent, geodesics are semicircles or vertical lines. Good for showing hierarchical depth.

**Band Model**: Infinite horizontal strip, useful for timeline views.

### 2. 3D Hyperbolic (H3) with WebGL

Upgrade from H2 to H3 for true volumetric navigation:

```typescript
// Hyperboloid model: x^2 + y^2 + z^2 - w^2 = -1, w > 0
interface H3Point {
  x: number; y: number; z: number; w: number;
}

// Poincare ball model (unit ball)
interface BallPoint {
  x: number; y: number; z: number; // |p| < 1
}

// H3 distance: acosh(-<a,b>_Minkowski)
function h3Dist(a: H3Point, b: H3Point): number {
  return Math.acosh(-(a.x*b.x + a.y*b.y + a.z*b.z - a.w*b.w));
}

// Ball to hyperboloid
function ballToH3(p: BallPoint): H3Point {
  const r2 = p.x*p.x + p.y*p.y + p.z*p.z;
  const denom = 1 - r2;
  return {
    x: 2*p.x/denom,
    y: 2*p.y/denom,
    z: 2*p.z/denom,
    w: (1+r2)/denom
  };
}
```

**Benefits:**
- Exponentially more space for node placement
- Natural 3D navigation with quaternion rotations
- Can embed current 2D disk as equatorial slice
- Enables nested spaces (hyperbolic fractals)

### 3. Multi-Minimap Architecture

```
+------------------------------------------+
|  [Klein]  [Half-Plane]  [Depth Slice]    |  <- Draggable minimap bar
|    ○           |          Layer 0: ●     |
|   /|\          |   ●      Layer 1: ○○    |
|  ○-○-○         |  / \     Layer 2: ●●●   |
|   \|/          | ●   ●    Layer 3: ○○○○  |
|    ○           |___/      Layer 4: ●●    |
+------------------------------------------+
|                                          |
|         [Main Poincare Disk]             |
|                                          |
+------------------------------------------+
```

Each minimap:
- Click to pan main view
- Drag to reposition the minimap itself
- Different geometry/projection
- Synchronized selection highlight
- Optional: independent zoom level

### 4. Cluster Manipulation in Hyperbolic Space

```typescript
class HyperbolicCluster {
  nodeIds: Set<string>;

  // Hyperbolic centroid via iterative optimization
  computeCentroid(): Complex {
    // Use Frechet mean in hyperbolic space
    let centroid = C(0, 0);
    for (let i = 0; i < 10; i++) {
      let gradient = C(0, 0);
      for (const id of this.nodeIds) {
        const node = getNode(id);
        // Log map at centroid gives direction
        const dir = hypLog(centroid, node.z);
        gradient = cadd(gradient, dir);
      }
      // Exponential map to step
      centroid = hypExp(centroid, cscale(gradient, 0.1));
    }
    return centroid;
  }

  // Tighten: move nodes toward centroid
  tighten(factor: number = 0.2) {
    const c = this.computeCentroid();
    for (const id of this.nodeIds) {
      const node = getNode(id);
      node.z = geodesicLerp(node.z, c, factor);
    }
  }

  // Widen: move nodes away from centroid
  widen(factor: number = 0.2) {
    const c = this.computeCentroid();
    for (const id of this.nodeIds) {
      const node = getNode(id);
      // Extrapolate along geodesic
      node.z = geodesicLerp(c, node.z, 1 + factor);
    }
  }

  // Rotate cluster around its centroid
  rotate(angle: number) {
    const c = this.computeCentroid();
    for (const id of this.nodeIds) {
      const node = getNode(id);
      // Mobius rotation: conjugate by translation to origin
      const atOrigin = mobius(c, node.z);
      const rotated = cmul(atOrigin, cpolar(1, angle));
      node.z = mobiusInv(c, rotated);
    }
  }
}
```

### 5. Higher-Dimensional Considerations

For H^n (n > 3), direct visualization isn't possible, but we can use:

**Projection Slicing**: Show 2D slices through higher-dimensional hyperbolic space
**Dimensionality Reduction**: PCA or t-SNE adapted to hyperbolic metric
**Nested Disks**: Each node contains a sub-disk (hyperbolic fractals)
**Parallel Coordinates**: Multiple linked 2D views

---

## Implementation Priority

### Phase 1: Fix What's Broken
1. Wire up "Show all" button
2. Make minimap interactive (click to pan)
3. Implement Escape hierarchy (focus -> edit -> parent)

### Phase 2: Core New Features
4. Node creation (Tab/Space/Return)
5. Content editing in Details panel
6. IndexedDB persistence

### Phase 3: Geometry Extensions
7. Klein disk minimap
8. Half-plane minimap
9. Cluster tighten/widen controls
10. Depth legend with palette tweaking

### Phase 4: H3 Upgrade
11. WebGL rendering pipeline
12. H3 math library
13. 3D navigation controls
14. 2D/3D toggle

---

## Files

| File | Lines | Purpose |
|------|-------|---------|
| hyperbolic-engine.js | 5,895 | Core geometry + rendering + domains |
| lorentz-geometry.js | 733 | H^n Lorentz/hyperboloid model |
| geometry-extensions.js | 666 | Voronoi, Klein, parallel transport |
| hyperbolic-workspace-pro.html | 2,534 | Full UI with styles |
| scripts/deploy.sh | 168 | Deployment automation |
| scripts/validate.sh | 153 | Pre-deploy validation |

## Documentation

| File | Purpose |
|------|---------|
| ARCHITECTURE.md | Mathematical foundations (Poincaré, Lorentz, ClojureScript) |
| STATUS.md | Implementation status (this file) |
| EXTENSIONS.md | Geometric primitives roadmap |
| LEDGER.md | Capacity & obligation tracking |
| DEPLOY.md | Deployment procedures |
| CONTENT-MAP.md | Context → Canvas mappings |

---

## Geometry Evolution Forks

Three clean attractors for evolving beyond 2D Poincaré disk:

### Fork A: Lorentz / Hyperboloid in R^{n,1} (Most Pragmatic)

Switch internal representation to hyperboloid model:

```
⟨x,x⟩_L = -1,  x_0 > 0
⟨x,y⟩_L = -x_0·y_0 + Σ x_i·y_i
```

**Benefits:**
- Dimension n can be 8, 16, 64 — "hyperbolic but high-D"
- Camera moves are matrix multiplications O(n²)
- Distances are cheap: `cosh(d) = -⟨x,y⟩_L`
- Great for hierarchies and tree-like semantic space
- Render by projecting to Poincaré ball or tangent plane

**Implementation:**
```typescript
interface LorentzPoint {
  coords: Float32Array;  // [x_0, x_1, ..., x_n] where x_0 > 0
}

function lorentzDist(a: LorentzPoint, b: LorentzPoint): number {
  let inner = -a.coords[0] * b.coords[0];
  for (let i = 1; i < a.coords.length; i++) {
    inner += a.coords[i] * b.coords[i];
  }
  return Math.acosh(-inner);
}
```

### Fork B: Field-First GPU Sampling (Most "Radiance")

Replace "drawing edges" with continuous field sampling:

```
F(x) = Σ_i w_i · K(d(x, x_i))
F(x,t) = Σ_i w_i · K(d) + Σ_events A·e^{-λd}·sin(ωt - κd)
```

**Benefits:**
- UI becomes a measured phenomenon, not a diagram
- Render via ray marching / sampling on GPU (WebGL/WebGPU)
- Can sample on geodesic polar grids, icosahedral meshes
- Ripples become real wave terms on the field

**Implementation:**
- Define radiance field F(x, context) as kernel sum in hyperbolic distance
- Render disk/ball chart + field sampler overlay (heatband / flow lines)
- Pins become constraints in camera group optimization

### Fork C: Conformal Geometric Algebra (Most Liberated Algebraically)

Use CGA for unified transforms where points, spheres, planes, circles, lines,
reflections, rotations, translations, dilations are all first-class:

```
X' = R X R̃  (sandwich product)
```

**Benefits:**
- Geodesics and constraints become primitives
- Camera actions are clean sandwich products
- Pinned anchors become constraints with projection operators
- Representation stops being ad hoc

**Key CGA Concepts:**
- Points as null vectors in R^{4,1}
- Spheres, planes as blades
- Meet & join operations
- Versors for all conformal transformations

---

## Efficiency Techniques (For Any Fork)

Move from O(E) edge drawing to:

1. **Multiresolution LOD rings** (coarse-to-fine)
2. **View-dependent selection** (only render nodes with projected measure > threshold)
3. **Edge bundles / flows / densities** until zoom in
4. **Barnes-Hut / FMM** approximation for field sums
5. **Hyperbolic ball tree** for fast queries
6. **Sparse K-nearest evaluation** at each sample point

---

## Next Steps

1. **Minimal upgrade**: Implement Lorentz model (n=8) internally, keep Poincaré rendering
2. **Add WebGL path**: Ray march a kernel field for ambient glow
3. **Long-term**: CGA unification for clean constraint handling
