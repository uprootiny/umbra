# UX Specification: Interaction Standards

**Date:** 2026-02-16
**Applies to:** All Umbra workspace interfaces

---

## 1. Transition Standards

| Context | Duration | Easing | Variable |
|---------|----------|--------|----------|
| Hover state change | 100ms | ease | `--transition-fast` |
| Panel/modal appear | 200ms | cubic-bezier(.2,0,0,1) | `--transition-normal` |
| Layout shift | 400ms | cubic-bezier(.2,0,0,1) | `--transition-slow` |
| Button press | 50ms | linear | (inline) |
| List item stagger | +30ms per item | — | (animation-delay) |
| Value update flash | 600ms | ease-out | (keyframe) |

**Rule:** Never use `display: none` ↔ `display: block/flex` for state transitions. Use `opacity` + `pointer-events` + `transform` instead.

**Rule:** Never hardcode transition durations. Use CSS variables exclusively so themes can override.

---

## 2. Color Standards

### Interactive States

| State | Background | Border | Text |
|-------|-----------|--------|------|
| Default | transparent | `--border-subtle` | `--text-secondary` |
| Hover | `color-mix(in srgb, white 4%, var(--bg-base))` | `--border-default` | `--text-primary` |
| Active/pressed | `color-mix(in srgb, white 2%, var(--bg-base))` | — | — |
| Selected | `color-mix(in srgb, var(--accent-blue) 12%, transparent)` | `color-mix(in srgb, var(--accent-blue) 25%, transparent)` | `--accent-blue` |
| Disabled | — | — | `opacity: 0.3` |
| Focus-visible | — | `#6eb5ff` 3px outline | — |

### Mode Colors

| Mode | Color Variable | Accent |
|------|---------------|--------|
| Pan | `--accent-blue` | #6eb5ff |
| Select | `--accent-cyan` | #79c0ff |
| Measure | `--accent-orange` | #ffb574 |
| Path | `--accent-yellow` | #ffd666 |

---

## 3. Icon Size System

| Tier | Size | Usage |
|------|------|-------|
| xs | 12px | Inline badges, status indicators |
| sm | 16px | Topbar buttons, context menu icons |
| md | 20px | Dock items, panel actions |
| lg | 24px | Command palette icons, HUD buttons |

---

## 4. Spacing System

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | 4px | Inline padding, icon gaps |
| `--space-sm` | 8px | Button padding, list item gaps |
| `--space-md` | 12px | Section padding, card gaps |
| `--space-lg` | 16px | Panel padding, modal padding |
| `--space-xl` | 24px | Section separators |

---

## 5. Button Press Behavior

All interactive elements must respond to `:active` with:
```css
transform: scale(0.96);
transition-duration: 50ms;
```

---

## 6. Modal/Overlay Entrance

All modals (command palette, context menu, dialogs) must:
1. Fade backdrop from `rgba(0,0,0,0)` to `rgba(0,0,0,0.6)` over `--transition-normal`
2. Scale content from `0.97` to `1.0` with `cubic-bezier(.2,0,0,1)`
3. Use `pointer-events: none/auto` instead of `display: none/block`

---

## 7. List Rendering

Lists of 4+ items must stagger entrance animation:
- First item: 0ms delay
- Each subsequent: +30ms
- Cap at 150ms (item 6+: all 150ms)
- Use `listSlideIn` keyframe (translateY 6px → 0, opacity 0 → 1)

---

## 8. Status Updates

Metric value changes must:
1. Briefly flash the accent color on the changed value (600ms ease-out)
2. Return to normal color via transition
3. Not animate on initial render

---

## 9. Accessibility Requirements

- All interactive elements must have `aria-label` or visible text
- `:focus-visible` outline: 3px solid `#6eb5ff`, offset 2px
- Touch targets: minimum 44x44px on mobile
- No color-only indicators — supplement with shape or pattern
- `prefers-reduced-motion: reduce` disables all animations
- Command palette must support Home/End keyboard navigation
- Viewport meta must allow user scaling

---

## 10. Responsive Breakpoints

| Breakpoint | Behavior |
|-----------|----------|
| > 1200px | Full layout: dock + canvas + panel |
| 768–1200px | Collapsible sidebars, reduced padding |
| < 768px | Drawer navigation, bottom-sheet modals, 44px touch targets |

Context menus on mobile: full-width bottom sheet with `max-height: 60vh` and scroll.
