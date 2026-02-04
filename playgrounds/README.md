# Mathematical Playgrounds

Interactive UIs for exploring and composing mathematical concepts.

## Quick Links

| Playground | Concepts | Status |
|------------|----------|--------|
| [Tensor Playground](tensor.html) | Einstein summation, tensor networks | Implemented |
| [Hyperbolic Embeddings](hyperbolic.html) | Poincaré disk, Lorentz model | Implemented |
| [Attention Visualizer](attention.html) | Self-attention, multi-head | Implemented |
| [Geometric Algebra](ga.html) | CGA, versors, meet/join | Implemented |
| [Proof Tree Composer](proofs.html) | Tactics, type theory | Implemented |
| [Historical Linguistics](linguistics.html) | Semitic languages, cognates, sound changes | Implemented |
| Condensed Explorer | Pyknotic sets, solid modules | Planned |

---

## 1. Tensor Playground (`tensor.html`)

**Concepts**: Einstein summation, tensor networks, index contraction

### Features:
- **Einsum builder**: Visual construction of `np.einsum('ij,jk->ik', A, B)`
- **Tensor blocks**: Drag-and-drop tensors with labeled indices
- **Contraction lines**: Connect matching indices to contract
- **Live evaluation**: See result shape and values
- **Common patterns**: Matrix multiply, trace, outer product, batched ops

### UI Sketch:
```
┌─────────────────────────────────────────────────────┐
│  [A]──i,j──┐    ┌──j,k──[B]                        │
│            └────┘                                   │
│                 ↓                                   │
│            [Result: i,k]                           │
│                                                     │
│  einsum('ij,jk->ik', A, B)  →  shape: (3,4)        │
└─────────────────────────────────────────────────────┘
```

---

## 2. Proof Tree Composer (`proofs.html`)

**Concepts**: Tactics, type theory, proof terms, Curry-Howard

### Features:
- **Goal display**: Current proof state with hypotheses and target
- **Tactic palette**: intro, apply, rewrite, induction, cases
- **Tree visualization**: Proof tree grows as tactics applied
- **Type checking**: Live feedback on well-formedness
- **Export**: Generate Lean 4 / Coq syntax

### UI Sketch:
```
┌─────────────────────────────────────────────────────┐
│  Goal: ∀ n : ℕ, n + 0 = n                          │
│  ─────────────────────────                          │
│  │ intro n                                          │
│  ├─► Goal: n + 0 = n                               │
│  │   │ induction n                                  │
│  │   ├─► base: 0 + 0 = 0  ✓ (by rfl)              │
│  │   └─► step: (n+1) + 0 = n+1                     │
│  │       │ simp [ih]  ✓                            │
│  └─► QED                                            │
└─────────────────────────────────────────────────────┘
```

---

## 3. Geometric Algebra Sandbox (`ga.html`)

**Concepts**: Clifford algebra, CGA, versors, meet/join

### Features:
- **Object palette**: Points, lines, planes, circles, spheres
- **Versor builder**: Compose rotations, translations, dilations
- **Sandwich preview**: See X' = R X R̃ applied live
- **Meet/join**: Intersect and span geometric objects
- **Projection toggles**: View in 2D slice, 3D, or algebraic form

### UI Sketch:
```
┌─────────────────────────────────────────────────────┐
│  Objects          │  Canvas (3D)      │  Algebra   │
│  ● Point A        │      ○            │  A = e₀+.. │
│  ● Point B        │     /│\           │  B = e₀+.. │
│  ─ Line AB        │    / │ \          │  L = A∧B   │
│  ○ Circle C       │   ●──●──●         │  C = ...   │
│                   │                    │            │
│  [Rotate] [Trans] │  ← drag to rotate │            │
└─────────────────────────────────────────────────────┘
```

---

## 4. Attention Visualizer (`attention.html`)

**Concepts**: Self-attention, multi-head, KQV, softmax

### Features:
- **Token input**: Enter a sequence, see tokenization
- **QKV matrices**: Visualize query, key, value projections
- **Attention heatmap**: Interactive attention weights
- **Head selector**: Switch between attention heads
- **Residual stream**: See information flow through layers

### UI Sketch:
```
┌─────────────────────────────────────────────────────┐
│  Input: [The] [cat] [sat] [on] [the] [mat]         │
│                                                     │
│  Attention (Head 3):                               │
│       The  cat  sat  on  the  mat                  │
│  The  ░░░  ▓▓▓  ░░░  ░░░  ░░░  ░░░                │
│  cat  ░░░  ░░░  ▓▓▓  ░░░  ░░░  ░░░                │
│  sat  ░░░  ▓▓▓  ░░░  ▓▓▓  ░░░  ░░░                │
│  ...                                                │
│                                                     │
│  [Head 1] [Head 2] [Head 3*] [Head 4]              │
└─────────────────────────────────────────────────────┘
```

---

## 5. Hyperbolic Embedding Playground (`hyperbolic.html`)

**Concepts**: Poincaré embeddings, Lorentz model, geodesics, hierarchy

### Features:
- **Dual view**: Poincaré disk + Lorentz hyperboloid side-by-side
- **Point placement**: Click to add points, drag to move
- **Geodesic drawing**: Connect points with hyperbolic lines
- **Distance meter**: Show d_H between selected points
- **Hierarchy test**: Import tree, see how hyperbolic captures it

### UI Sketch:
```
┌─────────────────────────────────────────────────────┐
│  Poincaré Disk        │  Lorentz Hyperboloid       │
│       ○               │         ╱│╲                │
│      /│\              │        ╱ │ ╲               │
│     ● ● ●             │       ●  ●  ●              │
│    /│\ │ /\           │      /│\ │ /\              │
│   ●●●●●●●●●           │     ●●●●●●●●●              │
│                       │                             │
│  d(A,B) = 2.34        │  ⟨A,B⟩_L = -3.42          │
│                       │  d = acosh(3.42) = 2.34    │
└─────────────────────────────────────────────────────┘
```

---

## 6. Condensed Math Explorer (`condensed.html`)

**Concepts**: Pyknotic/condensed sets, solid modules, liquid vectors

### Features:
- **Category browser**: Navigate Cond(Ab), Solid, Liquid
- **Functor diagram**: See how objects map between categories
- **Completion visualizer**: Show how "condensed" adds limits
- **Six functors**: f_*, f^*, f_!, f^!, ⊗, Hom
- **Example gallery**: Key constructions from Clausen-Scholze

### UI Sketch:
```
┌─────────────────────────────────────────────────────┐
│  Sets → Pro(Fin) → Cond(Sets) → Cond(Ab)           │
│    │        │           │            │              │
│    ▼        ▼           ▼            ▼              │
│   {*}    lim ←      Condensed     Solid            │
│          finite       point       module            │
│                                                     │
│  [Example: ℝ as condensed ring]                    │
│  ℝ = colim_{ε→0} C([-1/ε, 1/ε], ℝ)                │
└─────────────────────────────────────────────────────┘
```

---

## Implementation Status

1. **Tensor Playground** - Implemented: drag-drop tensors, index connections, einsum generation
2. **Hyperbolic Embedding** - Implemented: dual Poincaré/Lorentz views, geodesics, tree embedding
3. **Attention Visualizer** - Implemented: multi-head attention heatmaps, QKV projections
4. **GA Sandbox** - Implemented: CGA points/lines/circles, versors, meet/join operations
5. **Proof Tree** - Implemented: tactic-style proofs, Lean 4 export
6. **Historical Linguistics** - Implemented: Semitic family tree, timeline, cognate sets, sound changes
7. **Condensed Explorer** - Planned: requires more specialized category theory UI

---

## 7. Historical Linguistics Explorer (`linguistics.html`)

**Concepts**: Language families, historical phonology, cognate analysis, corpus exploration

### Features:
- **Family tree**: Interactive Semitic language tree with dates and attestation
- **Timeline view**: Visualization of language periods and overlaps
- **Cognate browser**: Compare cognate sets across Hebrew, Arabic, Aramaic, Akkadian, Ugaritic
- **Sound changes**: Proto-Semitic to daughter languages (Canaanite Shift, Begadkefat, etc.)
- **Script evolution**: Trace alphabet development from Proto-Sinaitic to modern scripts
- **Corpus links**: Major texts and inscriptions by language

### UI Sketch:
```
┌─────────────────────────────────────────────────────────────┐
│  [Family Tree] [Timeline] [Cognates] [Sound Changes]        │
├──────────┬─────────────────────────┬────────────────────────┤
│ Semitic  │     ╭─ Akkadian         │ Selected: Hebrew       │
│  ├ East  │     │     ╭─ Hebrew     │ Period: 1200 BCE–now   │
│  ├ NW    │─────┤─────┤─ Phoenician │ Scripts: paleo, square │
│  │ ├ Can │     │     ╰─ Moabite    │ Corpora:               │
│  │ ├ Aram│     ╰─ Aramaic          │  • Hebrew Bible        │
│  ├ Arabic│           ╰─ Arabic     │  • Dead Sea Scrolls    │
│  └ South │                         │  • Mishnah             │
├──────────┴─────────────────────────┴────────────────────────┤
│ Timeline: ═══Akkadian═══ ════Hebrew════════════════════     │
│           ══Phoenician══ ════Aramaic═══════════════════     │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

- Standalone HTML files (like current workspace)
- Canvas 2D for diagrams
- WebGL for 3D views (GA, Lorentz)
- No build step, pure JS
- Integrate with main workspace via node links
