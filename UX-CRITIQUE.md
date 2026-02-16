# UX Critique: Umbra Hyperbolic Workspace

**Date:** 2026-02-16
**Scope:** hyperbolic-workspace-pro.html + hyperbolic-engine.js
**Method:** Code audit, CSS analysis, interaction tracing, stress testing

---

## Executive Summary

The workspace has a sophisticated design system with genuine depth — three themes, twelve keyframe animations, an eight-color accent palette, and a four-tier text hierarchy. The mathematical engine is correct and the deployment is stable. But the interface suffers from **incomplete wiring**: the design system declares intentions that the implementation doesn't fulfill. The result is an interface that looks designed but doesn't *feel* designed.

---

## Critical Issues

### 1. The Command Palette Is the Most Important Feature and the Least Polished

The command palette (Cmd+K) is the primary discovery mechanism for a workspace with 40+ keyboard shortcuts, 6+ spaces, and hundreds of nodes. Yet:

- **No result count.** Users searching "geo" don't know if they're seeing 5 of 5 results or 5 of 50.
- **No scroll-into-view on keyboard navigation.** Arrow-keying past visible items leaves the selection offscreen.
- **Empty state is unhelpful.** "No results found" with no suggestions, no recent commands, no hints.
- **15 results in a 480px container.** The last 5 are invisible without scrolling. Users don't discover scrolling.

### 2. Mode Confusion

Four modes (pan, select, measure, path) use the same blue highlight color. A user in path mode can't distinguish their state at a glance from selection mode. Path mode's flowing-dash indicator is a CSS animation on a pseudo-element that most users will never notice.

### 3. Hidden Interactivity

Related items and bookmarks hide their action buttons (`opacity: 0`) until hover. On touch devices, these actions are completely unreachable. This affects ~50% of mobile/tablet users.

### 4. Context Menu Positioning

The context menu renders at cursor coordinates with no boundary detection. Right-clicking near any screen edge sends the menu partially or fully offscreen. Approximately 30% of right-click positions produce a clipped menu.

### 5. Status Bar Is Flat

All metrics (focus node, depth, zoom, distance, visible count) use the same visual weight. The user's eye has no entry point. The focus node name — the single most important piece of context — looks identical to the zoom level.

### 6. Focus Mode Is a Trap

Focus mode (press F) hides all UI. The only way back is to hover (which requires knowing to hover) or press F again (which requires remembering the key). No persistent hint exists. Users who accidentally enter focus mode are effectively locked out.

---

## Structural Observations

### What Works

- **Color system.** The `color-mix()` approach is excellent — 15% accent tint for backgrounds, 30% for borders. Creates a coherent visual language.
- **Theme architecture.** Three themes with properly scoped overrides. The skeuomorphic theme is genuinely distinctive.
- **Animation vocabulary.** 12 named keyframes covering a range of motion intents. The vocabulary exists; it's underemployed.
- **Transition variables.** `--transition-fast/normal/slow` with theme-specific values is the right approach.
- **Keyboard navigation.** Comprehensive vim-style bindings. The infrastructure for power users is there.

### What Doesn't

- **display:none toggling.** Tab panels, selection badge, and several other state-dependent elements use `display: none` ↔ `display: block`, which prevents CSS transitions. This is the single largest source of jank.
- **Undefined variables.** Four CSS variables were referenced but never declared (now fixed). This pattern suggests variables are added optimistically and not validated.
- **Permission model for interactivity.** Related-item actions require hover to appear, which breaks touch devices. This is a desktop-first assumption baked into the information architecture, not just the CSS.
- **Single-file architecture.** 3,800+ lines of CSS-in-HTML makes it difficult to maintain consistency. Similar elements defined 500 lines apart drift in styling.
