# Umbra Capacity & Obligation Ledger

## Status Summary

| Component | Production (umbra.hyperstitious.art) | Local (jan2026/umbra) | Delta |
|-----------|--------------------------------------|----------------------|-------|
| **Core Engine** | Deployed | 3686 lines | Local ahead |
| **Domains** | 5 | 6 (+langs) | +1 |
| **Playgrounds** | 0 visible | 7 complete | +7 |
| **Gestures** | Basic | +Fold, +WitnessCut | +2 |
| **Multi-pin** | No | Yes | +1 |

---

## PRODUCTION BASELINE (umbra.hyperstitious.art)

### Core Features (Verified Live)
- [x] Hyperbolic Workspace Pro UI
- [x] Poincaré disk visualization
- [x] 5 domain spaces: Studies, Infra, GitHub, Notes, Math
- [x] Command palette (⌘K)
- [x] Vim-style navigation (hjkl)
- [x] Minimap with viewport
- [x] Breadcrumb navigation
- [x] History stack (back/forward)
- [x] Pinning nodes (Shift+click)
- [x] Bookmarks with localStorage
- [x] Geodesic edge rendering
- [x] Hyperbolic distance display
- [x] Path measurement mode
- [x] Multi-select
- [x] Focus mode (F)
- [x] Keyboard shortcuts overlay (?)
- [x] Right panel: Details, Bookmarks, Settings tabs
- [x] Context menu on right-click

### Missing from Production
- [ ] Languages domain (langs)
- [ ] Playgrounds link/integration
- [ ] Multi-pin clustering
- [ ] Fold/Unfold gestures
- [ ] Witness Cut gesture
- [ ] Fold library UI

---

## LOCAL IMPLEMENTATION (jan2026/umbra)

### Files
```
umbra/
├── hyperbolic-workspace-pro.html  (2362 lines) - Main UI
├── hyperbolic-engine.js           (3686 lines) - Core engine
├── lorentz-geometry.js            (733 lines)  - H^n math
├── playgrounds/
│   ├── tensor.html                (910 lines)  - Einsum builder
│   ├── hyperbolic.html            (1171 lines) - Poincaré/Lorentz
│   ├── attention.html             (940 lines)  - Transformer viz
│   ├── ga.html                    (1333 lines) - Geometric Algebra
│   ├── proofs.html                (1178 lines) - Proof trees
│   ├── linguistics.html           (1201 lines) - Semitic langs
│   └── category-computation.html  (1422 lines) - HoTT refl loops
└── [legacy versions v1-v3]
```

### Domains Implemented
| Key | Name | Icon | Status |
|-----|------|------|--------|
| studies | Studies | 📚 | Complete |
| infra | Infrastructure | 🖥️ | Complete |
| github | GitHub Projects | 🐙 | Complete |
| notes | Notes & Ideas | 📝 | Complete |
| math | Formal Methods | ∫ | Complete |
| **langs** | **Languages** | 𐤀 | **NEW** - Semitic family tree |

### New Gestures (Not in Production)

#### 1. Multi-Pin Clustering
```
relayoutAroundPins(graph, strength, iterations)
```
- Pin multiple nodes as gravitational anchors
- Related nodes cluster around pins
- Unrelated nodes repel
- Force-directed layout in hyperbolic space

#### 2. Fold System
```
fold(graph, nodeIds, name) → foldId
unfold(graph, foldId)
getFolds() → Map
```
- Collapse selection into named shape (◈)
- Preserves internal geometry
- Reversible, accountable
- Keyboard: `f` to fold, `u` to unfold

#### 3. Witness Cut
```
witnessAndRelease() → boolean
getWitnesses() → Array
```
- Ethical accounting before release
- Captures: focus, selections, pins, navigation depth
- Prompts acknowledgment dialog
- Stores witness records in localStorage
- Keyboard: `Shift+W`

---

## VESPERS (vespers.raindesk.dev)

### Status: DNS configured, not yet deployed

### Files Ready
```
vespers/
├── index.html                     - Landing page
├── caddy-config.txt              - Server config ready
├── tensor.html
├── hyperbolic.html
├── attention.html
├── ga.html
├── proofs.html
├── linguistics.html
└── category-computation.html
```

---

## OBLIGATIONS (What Needs Deployment)

### Priority 1: Sync to Production
- [ ] Deploy updated hyperbolic-engine.js with:
  - langs domain
  - Multi-pin clustering
  - Fold/Unfold system
  - Witness Cut
- [ ] Deploy updated hyperbolic-workspace-pro.html with langs dock item

### Priority 2: UI Surfacing
- [ ] Add visible Fold button in dock or HUD
- [ ] Add visible Witness Cut button
- [ ] Fold library panel (view/manage folds)
- [ ] Witness history panel

### Priority 3: Vespers Launch
- [ ] Verify DNS propagation for vespers.raindesk.dev
- [ ] Add Caddy config to server
- [ ] Test all 7 playgrounds

### Priority 4: Integration
- [ ] Link playgrounds from main Umbra workspace
- [ ] Cross-reference between workspace and playgrounds

---

## TECHNICAL DEBT

| Issue | Location | Severity |
|-------|----------|----------|
| Legacy HTML versions | hyperbolic-map-v[1-3].html | Low - can delete |
| No persistence for folds | hyperbolic-engine.js | Medium |
| Witness prompts use browser dialogs | witnessAndRelease() | Low |
| No undo stack | global | Medium |

---

## METRICS

| Metric | Value |
|--------|-------|
| Total lines of code | ~22,000+ |
| Core engine (hyperbolic-engine.js) | 5,895 lines |
| Lorentz geometry (lorentz-geometry.js) | 733 lines |
| Extensions (geometry-extensions.js) | 666 lines |
| Main UI (hyperbolic-workspace-pro.html) | 2,534 lines |
| Domains | 6 |
| Playgrounds | 7 |
| Custom gestures | 3 (multi-pin, fold, witness) |
| Keyboard shortcuts | ~30 |
| Node actions | 15+ (navigation, modes, API, inspection) |
| Numerical guards | 8 (EPSILON, MAX_ATANH_ARG, validators, etc.) |

---

## DOCUMENTATION

| Document | Purpose |
|----------|---------|
| ARCHITECTURE.md | Mathematical foundations, system design, ClojureScript path |
| STATUS.md | Implementation status, geometry extensions |
| EXTENSIONS.md | Geometric primitives roadmap |
| LEDGER.md | Capacity & obligation tracking (this file) |
| DEPLOY.md | Deployment procedures |
| CONTENT-MAP.md | Context → Canvas mappings |

---

*Last updated: 2026-01-18*
