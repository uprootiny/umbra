# Content Mapping: Context → Canvas

This document maps artifacts from the jan2026 workspace to natural positions in the Umbra hyperbolic canvas.

---

## I. Project Hierarchy

```
jan2026/                          ──▶  Canvas Root (origin)
├── umbra/                        ──▶  Domain: math (Umbra Foundations)
├── vespers/                      ──▶  Domain: studies (Playgrounds)
└── lookout/                      ──▶  (placeholder, unmapped)
```

---

## II. Umbra → Canvas Mappings

### Core Files → Math Domain

| File | Canvas Path | Tags |
|------|-------------|------|
| `hyperbolic-engine.js` | math > Umbra Foundations > Visualization Engine | `core`, `umbra`, `live` |
| `lorentz-geometry.js` | math > Umbra Foundations > Lorentz Geometry | `core`, `umbra`, `live` |
| `geometry-extensions.js` | math > Umbra Foundations > Geometric Overlays | `extension`, `umbra` |

### Mathematical Constructs → Math Domain

| Construct | Canvas Path | Description |
|-----------|-------------|-------------|
| Complex arithmetic | math > Umbra Foundations > Complex Arithmetic | C, cadd, cmul, cdiv, cexp, clog |
| Möbius transforms | math > Umbra Foundations > Complex Arithmetic > Möbius Transforms | T_a(z), T_a⁻¹(w) |
| Hyperbolic distance | math > Umbra Foundations > Hyperbolic Geodesics > Geodesic Distance | 2·arctanh formula |
| Geodesic lerp | math > Umbra Foundations > Hyperbolic Geodesics > Geodesic Lerp | tanh/atanh interpolation |
| Lorentz distance | math > Umbra Foundations > Lorentz Geometry > Minkowski Inner Product | cosh⁻¹(-⟨p,q⟩) |
| Exponential map | math > Umbra Foundations > Lorentz Geometry > Exponential Map | exp_p(v) on hyperboloid |
| Ball tree | math > Umbra Foundations > Spatial Indexing > Ball Trees | O(log n) kNN queries |
| Voronoi | math > Umbra Foundations > Geometric Overlays > Voronoi | Klein-model construction |
| Parallel transport | math > Umbra Foundations > Geometric Overlays > Parallel Transport | Vector field along geodesics |
| Tessellations | math > Umbra Foundations > Geometric Overlays > Tilings | {p,q} hyperbolic patterns |

### Scripts → Infra Domain

| Script | Canvas Path | Action |
|--------|-------------|--------|
| `scripts/deploy.sh` | infra > CI/CD > Deployment | `checkServiceHealth` |
| `scripts/validate.sh` | infra > CI/CD > Validation | `checkServiceHealth` |

---

## III. Vespers → Canvas Mappings

### Playgrounds → Studies Domain

| Playground | Canvas Path | Tags | Description |
|------------|-------------|------|-------------|
| tensor.html | studies > Mathematics > Tensor Computation | `interactive`, `live` | Einstein summation builder |
| hyperbolic.html | studies > Mathematics > Hyperbolic Geometry | `interactive`, `live` | Dual Poincaré/Lorentz view |
| attention.html | studies > Computer Science > AI/ML > Attention | `interactive`, `live` | Transformer QKV visualization |
| ga.html | studies > Mathematics > Geometric Algebra | `interactive`, `live` | CGA sandbox with versors |
| proofs.html | studies > Mathematics > Proof Assistants | `interactive`, `live` | Tactic-based proof trees |
| linguistics.html | langs > Semitic Languages | `interactive`, `live` | Family tree + cognates |
| category-computation.html | studies > Mathematics > Category Theory | `interactive`, `live` | HoTT and six functors |

### Playground Actions

Each playground node should have:

```javascript
{
  name: 'Tensor Playground',
  icon: '🧮',
  tags: ['interactive', 'live', 'vespers'],
  action: 'openPlayground',
  data: {
    url: 'https://vespers.raindesk.dev/tensor.html',
    local: '/playgrounds/tensor.html'
  }
}
```

---

## IV. Hyle Server → Canvas Mappings

### NLP Corpus Analytics → Langs Domain

| Endpoint | Canvas Path | Tags |
|----------|-------------|------|
| `/api/hebrew/stats` | langs > Corpus Analytics > Hebrew Corpus > Stats | `api`, `live` |
| `/api/hebrew/zipf` | langs > Corpus Analytics > Lexical Distribution > Zipf Exponent | `api`, `live` |
| `/api/linguistics/heaps` | langs > Corpus Analytics > Lexical Distribution > Heaps Law | `api`, `live` |
| `/api/linguistics/ttr` | langs > Corpus Analytics > Lexical Distribution > TTR | `api`, `live` |
| `/api/linguistics/hapax` | langs > Corpus Analytics > Lexical Distribution > Hapax Legomena | `api`, `live` |
| `/api/linguistics/burstiness` | langs > Corpus Analytics > Temporal Dynamics > Burstiness | `api`, `live` |
| `/api/linguistics/embedding-drift` | langs > Corpus Analytics > Semantic Structure > Embedding Drift | `api`, `live` |
| `/api/linguistics/polysemy` | langs > Corpus Analytics > Semantic Structure > Polysemy Index | `api`, `live` |
| `/api/linguistics/perplexity` | langs > Corpus Analytics > Information Theory > Perplexity | `api`, `live` |

---

## V. Documentation → Canvas Mappings

### Markdown Files → Notes Domain

| File | Canvas Path | Description |
|------|-------------|-------------|
| ARCHITECTURE.md | notes > Projects > Umbra > Architecture | Mathematical foundations |
| STATUS.md | notes > Projects > Umbra > Status | Implementation tracking |
| EXTENSIONS.md | notes > Projects > Umbra > Extensions | Geometry roadmap |
| LEDGER.md | notes > Projects > Umbra > Ledger | Capacity tracking |
| DEPLOY.md | notes > Projects > Umbra > Deployment | Ops procedures |
| CONTENT-MAP.md | notes > Projects > Umbra > Content Map | This document |

---

## VI. Infrastructure Mesh → Infra Domain

### Servers

| Host | Canvas Path | Observable |
|------|-------------|------------|
| umbra.hyperstitious.art | infra > Production > Web Cluster > Umbra | `checkServiceHealth` |
| vespers.raindesk.dev | infra > Production > Web Cluster > Vespers | `checkServiceHealth` |
| hyle (localhost:8769) | infra > Development > Local Services > Hyle | `openHyleEndpoint` |

### Deployment Pipeline

```
                    Canvas Representation:

infra > CI/CD > Pipeline
├── Validation (validate.sh)    ──▶  Pre-deploy checks
├── Build                       ──▶  (static files, no build step)
├── Deploy (deploy.sh)          ──▶  rsync to production
└── Health Check                ──▶  curl + HTTP status
```

---

## VII. GitHub Integration → GitHub Domain

### Repositories

| Repo | Canvas Path | Actions |
|------|-------------|---------|
| umbra | github > umbra | Issues, PRs, Actions |
| vespers | github > vespers | Issues, PRs |
| hyle | github > hyle | API server code |

### Suggested Expansion

```javascript
{
  name: 'umbra',
  icon: '🌀',
  tags: ['active', 'hyperbolic'],
  children: [
    { name: 'Issues', action: 'openGitHub', data: { path: '/issues' }},
    { name: 'Pull Requests', action: 'openGitHub', data: { path: '/pulls' }},
    { name: 'Actions', action: 'openGitHub', data: { path: '/actions' }},
    { name: 'Branches', children: [
      { name: 'main', tags: ['default'] },
      { name: 'cljs-rewrite', tags: ['feature'] },
      { name: 'webgl-h3', tags: ['experimental'] }
    ]}
  ]
}
```

---

## VIII. Knowledge Graph Topology

### Hyperbolic Embedding Rationale

The content naturally forms hierarchies:

```
                        Depth in Tree → Hyperbolic Distance from Origin

Level 0:  Domains (6)           ─────▶  Close to origin (|z| ≈ 0.1)
Level 1:  Categories (~30)      ─────▶  Ring at |z| ≈ 0.3
Level 2:  Topics (~100)         ─────▶  Ring at |z| ≈ 0.5
Level 3:  Subtopics (~300)      ─────▶  Ring at |z| ≈ 0.7
Level 4:  Leaves (~400+)        ─────▶  Near boundary (|z| ≈ 0.85)
```

### Cross-Domain Connections

| Connection | Type | Canvas Representation |
|------------|------|----------------------|
| Umbra math ↔ Studies hyperbolic geometry | semantic | Cross-edge (dashed) |
| Playgrounds ↔ Domain topics | interactive | Navigation link |
| Hyle API ↔ Langs corpus | data source | Action endpoints |
| Infra deploy ↔ GitHub actions | operational | Status integration |

---

## IX. Unmapped Content (Future Work)

### From EXTENSIONS.md (Pending P2-P4)

| Extension | Priority | Notes |
|-----------|----------|-------|
| Isometry decomposition | P2 | Animation of transforms |
| Dimension reduction | P2 | hypMDS, hypPCA |
| Triangulation | P2 | Delaunay in H² |
| H³ visualization | P3 | WebGL 3D hyperbolic |
| Adaptive curvature | P4 | Variable K spaces |

### Potential New Domains

| Domain | Key | Color | Content |
|--------|-----|-------|---------|
| reading | 📖 | #a8d2ff | Books, papers, articles queue |
| clojure | λ | #63b132 | ClojureScript codebase map |
| time | ⏰ | #ffd700 | Temporal view of project evolution |

---

## X. Implementation Checklist

### Phase 1: Enhance Existing Nodes

- [x] Math domain: Umbra Foundations section
- [x] Langs domain: Corpus Analytics with Hyle endpoints
- [x] Infra domain: Live inspection actions
- [ ] Studies domain: Link to Vespers playgrounds
- [ ] Notes domain: Link to documentation files

### Phase 2: Cross-Linking

- [ ] Add cross-edges between related nodes
- [ ] Implement `openPlayground` action
- [ ] Implement `openDocumentation` action
- [ ] Add bidirectional navigation (playground → domain topic)

### Phase 3: Dynamic Content

- [ ] Fetch GitHub issue counts
- [ ] Poll Hyle API status
- [ ] Show documentation preview on hover
- [ ] Live playground embedding (iframe)

---

## XI. ClojureScript Transition

When transitioning to ClojureScript:

```clojure
;; Content map as EDN
{:domains
 {:math
  {:color "#ff9bce"
   :icon "∫"
   :children
   [{:name "Umbra Foundations"
     :icon "🌀"
     :tags [:live :umbra]
     :children
     [{:name "Complex Arithmetic"
       :children
       [{:name "Möbius Transforms"
         :content "T_a(z) = (z-a)/(1-āz)"
         :tags [:core :umbra]}]}]}]}}}

;; Transform to graph
(defn content->graph [content]
  (reduce-kv
    (fn [graph domain-key domain]
      (let [root-id (uuid)]
        (-> graph
            (assoc-in [:nodes root-id]
                      {:id root-id
                       :name (name domain-key)
                       :z (c/origin)
                       :color (:color domain)})
            (add-children root-id (:children domain)))))
    {:nodes {} :edges {}}
    (:domains content)))
```

---

*Mapping generated 2026-01-18 for Umbra Hyperbolic Workspace*
