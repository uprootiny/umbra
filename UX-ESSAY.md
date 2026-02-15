# On Interface as Geometry: UX Reflections from Inside a Hyperbolic Workspace

**Written:** 2026-02-09
**Context:** After validating a live deployment (71/71 stress tests passing), fixing three integration bugs, auditing 3,800 lines of CSS for coherence, and instrumenting a measurement harness against the production endpoint at `umbra.hyperstitious.art`.

---

## I. The Contract Between Aspiration and Measurement

We have an architecture document that describes Möbius transformations, conformal mappings, and the Minkowski inner product with typeset precision. We have a status document that lists 9 features as MISSING or BROKEN. We have a deployment that returns 200 on all 22 endpoints in under 100ms and withstands 50-request bursts without flinching.

This is the real shape of a project: the mathematics is proven, the infrastructure is solid, the interaction layer is the gap. The interface is where the careful geometry meets the impatient hand, and it is there — not in the server config, not in the hyperbolic distance function — that the work is either felt or abandoned.

UX lives in this gap. Not in the aspirational architecture document. Not in the status page's honest accounting of what's broken. UX lives in whether a user who arrives at the landing page and clicks through to the Poincaré disk *feels* that the mathematics underneath is trustworthy, even though they will never read the `arctanh` implementation. The interface is the geometry's ambassador. And ambassadors are judged by their composure, not their credentials.

---

## II. What We Actually Know (Because We Measured It)

The stress test gave us a baseline vocabulary for talking about what works:

| Fact | Number | Implication |
|------|--------|-------------|
| Average response time | 84–99ms | The server is not the bottleneck. Any perceived slowness is client-side: rendering, layout, paint. |
| Largest asset | 319KB (engine.js) | Uncompressed. With gzip: ~80KB. This is fine, but it's a single file — no code splitting, no lazy loading. First meaningful paint depends entirely on this parse. |
| 20 concurrent requests | 100% success, 0.5s avg | Caddy handles load gracefully. Concurrency is not the problem domain. |
| TLS cert | 65 days remaining | Auto-renewal works. One less thing to worry about. |

These are the *known knowns*. They tell us where to stop worrying. The server is fast, stable, correctly configured. The problem space is narrowed to: **what happens after the bytes arrive in the browser?**

---

## III. What We Fixed (And What The Fixes Reveal)

Three bugs surfaced during validation:

1. **`switchSpace('studies')` referenced a nonexistent domain key.** The SPACES object uses `hyperbolic` but the keyboard handler and the API object both called it `studies` — a rename that wasn't propagated. This is a classic refactoring ghost: the architecture evolved, the references didn't. In UX terms, pressing `1` on the keyboard would silently fail. The user would press a key, nothing would happen, and they would lose a quantum of trust.

2. **`metricDist` existed in the engine (it reads the element) and in the older workspace HTML, but not in the Pro workspace.** The engine would silently get `null` from `getElementById`, and the distance metric would never display. The user would never see it fail — they'd just never know the feature existed. Silent absence is the cruelest UX failure mode because there's nothing to debug, nothing to complain about. The feature simply isn't.

3. **`geometry-extensions.js` wasn't loaded in the Pro workspace.** 666 lines of parallel transport, Voronoi overlays, and vector field visualization — present on disk, absent from the page. An entire mathematical layer, invisible.

These three bugs share a pattern: **the architecture expanded, the integration surface didn't follow.** This is the fundamental UX risk of ambitious projects. The mathematical core is correct. The deployment pipeline works. But the HTML file — the actual surface the user touches — is a manual integration point where things fall through the cracks.

**Lesson:** Validation scripts aren't bureaucracy. The `validate.sh` that checks DOM element bindings, script references, and domain definitions is *UX infrastructure*. It's the only thing standing between "the code exists" and "the user can reach it." We should expand it. Every feature flag, every script reference, every keyboard binding should have a corresponding assertion.

---

## IV. The CSS Archaeology Report

Auditing the stylesheet revealed a project in mid-evolution. The bones are excellent:

- **A coherent variable system.** Three tiers of background, four tiers of text, eight accent colors, space-specific color mappings. This isn't accidental — someone designed a visual hierarchy.
- **Three complete themes** (default dark, minimalist, skeuomorphic) with properly scoped overrides. The `color-mix()` usage throughout is modern and intentional.
- **Twelve keyframe animations** defined, covering pulse, breathe, float, bounce, shimmer, wiggle, orbit, ripple. A vocabulary of motion.

But then the connective tissue:

- **Four undefined CSS variables** (`--accent-primary`, `--accent-dim`, `--text-muted`, `--bg-hover`) referenced throughout the UI but never declared. Every element using these was silently falling back to `initial` — transparent backgrounds, invisible text.
- **The command palette** toggled via `display: none` / `display: flex`. No transition possible. The most-used power feature in the interface appeared and disappeared like a light switch. Binary. Artless.
- **The context menu** — same pattern. `display: none` to `display: block`. No easing, no origin-aware animation, no sense of where the menu came from.
- **Hardcoded transition durations** (`0.1s`) on `.ctrl-btn` while every other element used theme-aware CSS variables. A consistency crack.
- **No focus indicators.** `outline: none` on inputs with no replacement. Keyboard users navigate blind.

This is the contrast I want to name precisely: **the design system is sophisticated, the wiring is incomplete.** The variables exist for fast/normal/slow transitions — but they're not applied everywhere. The keyframe animations exist — but several are utility classes never attached to anything. The color hierarchy is elegant — but undefined aliases break it at runtime.

---

## V. What We Speculate About (And Should Measure)

Here is where aspiration outpaces data. We made changes today that feel right — staggered list animations, smooth palette entrance, focus rings, consistent press depth — but we have no measurement of their impact. This is the honest inventory of what remains unknown:

### 5.1 Does the command palette entrance animation improve or degrade perceived speed?

We added a `200ms` scale+opacity entrance. This *looks* polished. But if the user is opening the palette to quickly type a command name, 200ms of animation before the input is ready could feel slower than the old instant appearance. We don't know.

**Should measure:** Time from `Cmd+K` to first keystroke. Compare with and without animation. If animation adds perceived latency, shorten it to 120ms or make the input active during the animation (it is, but does the user *feel* that it is?).

### 5.2 Does staggered list animation improve scan behavior?

We added 30ms stagger delays to command results. The theory is that cascading appearance guides the eye downward through results. But if the user has already typed enough to narrow to 2–3 results, the stagger is just delay. A list of 2 items doesn't need choreography.

**Should measure:** Whether stagger delay should be conditional on result count. 1–3 results: no stagger. 4+: stagger. This requires instrumenting the command palette's result rendering.

### 5.3 What's the actual first-meaningful-paint time?

The engine.js is 320KB. It's loaded synchronously (no `async` or `defer`). The browser must download, parse, and execute it before anything renders. On a fast connection this is invisible. On a 3G connection in a café, it's potentially 3–5 seconds of blank screen.

**Should measure:** Use the Performance API to log:
- `DOMContentLoaded` timestamp
- First canvas render timestamp
- Time to interactive (first successful pan/zoom)

This data should be collected in production via a lightweight beacon. We're flying blind on real-world load performance.

### 5.4 Does focus mode actually help?

Focus mode hides the sidebars and topbar. We added smooth opacity + translate transitions for this. But the fundamental question isn't "does the animation look good" — it's "does anyone use focus mode, and do they stay in it?" If nobody toggles it, the feature (and its animation budget) is dead weight.

**Should measure:** Focus mode toggle frequency, average duration in focus mode, whether users who discover it retain it as a habit.

### 5.5 How do users discover keyboard shortcuts?

The workspace has extensive vim-style bindings. Pressing `?` shows a keyboard hints overlay. But how many users ever press `?`? How many discover that `1`–`6` switches spaces, that `M` enters measurement mode, that `F` folds selected nodes?

**Should measure:** Keyboard shortcut usage frequency, discovery path (did they press `?` first? Or stumble on it?), whether command palette searches for features that have keyboard shortcuts (indicating the shortcut isn't known).

### 5.6 Is the three-theme system used?

We have default, minimalist, and skeuomorphic themes. Each is carefully designed — the skeuomorphic theme has texture SVG noise filters, leather-warm gradients, elastic easings. But if 98% of users stay on default, the 300 lines of theme CSS are maintenance burden without audience.

**Should measure:** Theme selection frequency, whether theme preference correlates with session duration (do users who customize stay longer?), whether the skeuomorphic theme actually renders correctly across browsers (it uses advanced CSS features that may degrade).

---

## VI. The Geometry of Attention

There is a deeper connection between the project's mathematical content and its interface design that I want to make explicit.

In the Poincaré disk, the metric diverges at the boundary. Points near the center are "close" in both hyperbolic and Euclidean terms. Points near the edge are hyperbolically distant from the center but Euclidean-close to each other. The boundary itself is infinitely far away — you can never reach it, but you can always see it.

This is exactly how attention works in an interface. The focused element is at the center — large, detailed, close. Peripheral elements are visible but compressed. The boundary of the viewport is always present but never reachable in the sense that there's always more beyond it. The hyperbolic disk is, quite literally, a model of how visual attention distributes information across a finite display.

This means the project's math isn't just content — it's *architecture*. The exponential growth of hyperbolic space maps naturally to the exponential growth of information hierarchies. A tree with branching factor 4 and depth 6 has 4,096 leaves. In Euclidean space, displaying all of them requires either scrolling or microscopic text. In hyperbolic space, they fit naturally: the leaves near your focus are legible, the distant ones are tiny but present, and you can Möbius-transform any leaf to the center with a single click.

The UX implication is that *navigation IS the visualization*. There shouldn't be a separate "search" and a separate "browse" and a separate "filter." Moving through the space is all three simultaneously. When you pan toward a cluster of nodes, you're browsing. When you focus a node, you've searched. When nodes outside your depth threshold fade, you've filtered. The interface should make these equivalences felt, not explained.

This is what the staggered animations and smooth transitions are ultimately serving: the illusion of continuous space. If the command palette snaps open, it breaks the spatial metaphor — you've been teleported. If it scales in from a point, you've *moved* to it. If breadcrumbs slide in from the left, you have a directional sense of where you came from. If the sidebar fades smoothly when focus mode activates, the space expanded — you didn't toggle a boolean, you *widened your field of view*.

---

## VII. What Should Be Experimented With

The validated deployment gives us a stable platform for experimentation. Here's what I'd run:

### Experiment 1: Animation Timing Curve Comparison
**Hypothesis:** The current `cubic-bezier(.2,0,0,1)` (fast exit, soft land) feels more natural than the default `ease` for UI elements, but `ease-out` might feel faster for command palette appearance.
**Method:** A/B the command palette entrance with three curves, measure time-to-first-keystroke and subjective "speed" rating.

### Experiment 2: Distance Metric Display
**Hypothesis:** Showing the hyperbolic distance (`metricDist`) in the status bar helps users build intuition about the space, but might be noise for casual users.
**Method:** Toggle `metricDist` visibility, measure whether users who see it navigate more efficiently (fewer clicks to reach target nodes).

### Experiment 3: Depth-Adaptive Node Rendering
**Hypothesis:** Nodes beyond depth 3 from focus could be rendered as abstract shapes (dots, lines) rather than full labels, reducing visual clutter without reducing navigability.
**Method:** Implement a depth threshold for label rendering, measure task completion time for "find node X" tasks.

### Experiment 4: Keyboard vs. Command Palette vs. Click Navigation
**Hypothesis:** Power users converge on keyboard shortcuts, casual users stay on mouse, and the command palette serves the transition between the two.
**Method:** Instrument all three navigation paths, measure which path users take for the same actions over time. Does command palette usage decrease as keyboard shortcut usage increases?

### Experiment 5: Theme as Context
**Hypothesis:** Instead of a static preference, theme should respond to context. Minimalist for reading/editing content. Default for navigation. Skeuomorphic for presentation/demo mode.
**Method:** Offer context-triggered theme suggestions, measure adoption.

---

## VIII. The Honest Summary

We have a mathematically rigorous hyperbolic geometry engine. We have a stable deployment with comprehensive monitoring. We have a CSS design system with genuine sophistication — three themes, twelve animations, a considered color hierarchy.

What we lack is *measurement of the human side*. Every UX decision we've made — the stagger timing, the entrance curves, the focus ring color, the status bar layout — is an educated guess informed by craft knowledge and aesthetic sensibility. These guesses are probably 70% right. But the 30% we're wrong about will compound into the subtle feeling of "something's off" that separates tools people tolerate from tools people love.

The stress test validated the machine. The next test suite needs to validate the experience. That means:

1. **Instrumentation.** Every interaction should emit a lightweight event: what was clicked, what was typed, how long the user paused, what they did next. Not for surveillance — for understanding.

2. **Session replay.** Not video — structured logs. "User opened palette, typed 'geo', selected third result, navigated to Geodesics node, spent 14 seconds reading, pressed `?`, browsed shortcuts for 8 seconds, pressed Escape." These narratives are worth more than any A/B test.

3. **Progressive disclosure metrics.** How many features does a user discover in their first session? Their fifth? Their tenth? The workspace has ~40 keyboard shortcuts, 6 spaces, 7 playgrounds, 3 themes, 5 overlay modes, and a command palette with fuzzy search. That's a lot of surface area. What's the discovery curve?

4. **Exit signals.** When users leave, what was the last thing they did? If they leave mid-navigation, maybe the space was disorienting. If they leave after opening the command palette and closing it without selecting anything, maybe search failed them. The exit is the most honest feedback.

The architecture is sound. The geometry is correct. The deployment is validated. Now the work is to close the loop between what the interface *does* and what the human *experiences* — and to do that, we need to watch, measure, and iterate with the same rigor we applied to the Poincaré metric.

The conformal factor diverges at the boundary. So does the importance of getting the details right.

---

*Written from inside the codebase, after touching every layer from TLS certificates to CSS keyframes. The numbers are real. The questions are open.*
