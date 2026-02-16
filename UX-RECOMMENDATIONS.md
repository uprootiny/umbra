# UX Recommendations: Priority Implementation Plan

**Date:** 2026-02-16
**Based on:** UX-CRITIQUE.md, UX-ASSESSMENT.md, 48-point audit

---

## Tier 1: Fix Now (Breaks Things)

### R1. Context Menu Boundary Detection
**Problem:** Menu renders offscreen ~30% of the time
**Fix:** Add viewport collision detection in `showContextMenu()`:
```
if (x + menuWidth > viewportWidth) x = viewportWidth - menuWidth - 8;
if (y + menuHeight > viewportHeight) y = viewportHeight - menuHeight - 8;
```
**Files:** hyperbolic-engine.js (showContextMenu function)
**Effort:** 10 lines

### R2. Always-Visible Action Buttons
**Problem:** Related-item and bookmark actions hidden until hover; unreachable on touch
**Fix:** Show actions at `opacity: 0.4` always, `opacity: 1` on hover. Remove `opacity: 0`.
**Files:** hyperbolic-workspace-pro.html (CSS)
**Effort:** 4 lines

### R3. Focus Mode Exit Hint
**Problem:** Users trapped with no visible escape
**Fix:** In focus mode, show a persistent low-opacity hint: "F to exit focus" at bottom-center
**Files:** hyperbolic-workspace-pro.html (CSS + small HTML addition)
**Effort:** 15 lines

---

## Tier 2: Polish Pass (Feels Wrong)

### R4. Mode-Specific Colors
**Problem:** All four modes look the same when active
**Fix:** Assign distinct colors per mode:
- Pan: default blue
- Select: cyan
- Measure: orange
- Path: yellow
**Files:** hyperbolic-workspace-pro.html (CSS), hyperbolic-engine.js (mode switching)
**Effort:** 20 lines

### R5. Tab Panel Transitions
**Problem:** Tab switches are instant `display:none` swaps
**Fix:** Replace with opacity+transform transitions using pointer-events control:
```css
.tab-panel { opacity: 0; transform: translateY(6px); pointer-events: none; transition: all 200ms ease; }
.tab-panel.active { opacity: 1; transform: translateY(0); pointer-events: auto; }
```
**Files:** hyperbolic-workspace-pro.html (CSS)
**Effort:** 8 lines

### R6. Status Bar Hierarchy
**Problem:** All metrics same visual weight
**Fix:**
- Focus node name: `--text-primary`, 14px, font-weight 600
- Depth: keep secondary
- Zoom/distance: `--text-tertiary`, smaller
- Add subtle separator styling
**Files:** hyperbolic-workspace-pro.html (CSS)
**Effort:** 10 lines

### R7. Command Palette Improvements
**Problem:** No result count, no scroll-into-view, weak empty state
**Fix:**
- Add result counter: "N of M" in palette header
- `scrollIntoView({ block: 'nearest' })` on keyboard nav
- Empty state: "Type to search or press ↓ for all"
- Reduce max results to 10
**Files:** hyperbolic-engine.js (command palette functions)
**Effort:** 25 lines

### R8. Selection Badge Always Visible
**Problem:** Badge disappears when count is 0 — no discoverability
**Fix:** Always show badge, use `--text-disabled` when count=0, animate on change
**Files:** hyperbolic-engine.js (status update), CSS
**Effort:** 10 lines

---

## Tier 3: Accessibility Pass (Required for Professional Grade)

### R9. ARIA Labels
**Fix:** Add `aria-label`, `role`, `aria-pressed`/`aria-selected` to:
- Mode buttons
- Command palette items
- Panel tabs
- Status bar values
**Effort:** 30 lines across HTML

### R10. Focus Indicator Strengthening
**Fix:** Change `:focus-visible` outline from `rgba(110,181,255,.4)` to `#6eb5ff` (100% opacity), 3px width
**Effort:** 2 lines

### R11. Mobile Context Menu Scroll
**Fix:** Add `max-height: 60vh; overflow-y: auto;` to context menu in mobile breakpoint
**Effort:** 2 lines

### R12. Viewport Zoom
**Fix:** Change `user-scalable=no` to `user-scalable=yes` in viewport meta
**Effort:** 1 line

---

## Tier 4: Refinement (Dribbble-Grade)

### R13. Breadcrumb Tooltips
Show full path text on hover for truncated breadcrumb segments.

### R14. Node Hover Always Active
Remove the settings gate on hover feedback — always show size increase on hover.

### R15. Related Items Pagination
Limit to 8 items with "Show all (N more)" expansion.

### R16. Icon Size System
Standardize to 12/16/20/24px tiers across all components.

---

## Implementation Order

```
Session 1: R1, R2, R3, R10, R11, R12          (30 min — unblock critical paths)
Session 2: R4, R5, R6, R8                      (30 min — state communication)
Session 3: R7                                   (20 min — command palette)
Session 4: R9                                   (20 min — accessibility)
Session 5: R13–R16                              (30 min — refinement)
```

Total: ~50 targeted edits across 2 files.
