#!/bin/bash
# Umbra Validation Script
# Run before deployment to ensure code integrity

set -e
cd "$(dirname "$0")/.."

echo "═══════════════════════════════════════════════════════════"
echo "  UMBRA VALIDATION"
echo "═══════════════════════════════════════════════════════════"
echo ""

ERRORS=0

# 1. JavaScript syntax
echo "▶ Checking JavaScript syntax..."
if node --check hyperbolic-engine.js 2>/dev/null; then
  echo "  ✓ hyperbolic-engine.js"
else
  echo "  ✗ hyperbolic-engine.js has syntax errors"
  ERRORS=$((ERRORS + 1))
fi

if node --check lorentz-geometry.js 2>/dev/null; then
  echo "  ✓ lorentz-geometry.js"
else
  echo "  ✗ lorentz-geometry.js has syntax errors"
  ERRORS=$((ERRORS + 1))
fi

# 2. Check playground scripts
echo ""
echo "▶ Checking playground scripts..."
for f in playgrounds/*.html; do
  name=$(basename "$f")
  # Extract script and check
  if sed -n '/<script>/,/<\/script>/p' "$f" 2>/dev/null | sed '1d;$d' > /tmp/check.js && [ -s /tmp/check.js ]; then
    if node --check /tmp/check.js 2>/dev/null; then
      echo "  ✓ $name"
    else
      echo "  ✗ $name has syntax errors"
      ERRORS=$((ERRORS + 1))
    fi
  else
    echo "  ~ $name (inline script not extractable)"
  fi
done

# 3. Check required DOM elements
echo ""
echo "▶ Checking DOM element bindings..."
REQUIRED_IDS="canvas minimap main spaceName spaceMeta metricFocus metricDepth metricZoom metricDist nodeAvatar nodeName nodeType nodeBadges propsGrid relatedList actPin breadcrumb selectionBadge pathBadge pinnedList recentList statNodes statEdges statPinned statDepth tooltip contextMenu commandOverlay commandInput commandResults searchTrigger keyboardHints app btnHome btnBack btnFwd actCenter actExpand legend dockTooltip"

MISSING=0
for id in $REQUIRED_IDS; do
  if ! grep -q "id=\"$id\"" hyperbolic-workspace-pro.html; then
    echo "  ✗ Missing element: $id"
    MISSING=$((MISSING + 1))
  fi
done
if [ $MISSING -eq 0 ]; then
  echo "  ✓ All $(echo $REQUIRED_IDS | wc -w) required elements present"
else
  ERRORS=$((ERRORS + MISSING))
fi

# 4. Check domains
echo ""
echo "▶ Checking domain definitions..."
DOMAINS="hyperbolic infra github notes math langs"
for domain in $DOMAINS; do
  if grep -q "^\s*$domain:" hyperbolic-engine.js; then
    echo "  ✓ $domain"
  else
    echo "  ✗ Missing domain: $domain"
    ERRORS=$((ERRORS + 1))
  fi
done

# 5. File size sanity check
echo ""
echo "▶ Checking file sizes..."
ENGINE_LINES=$(wc -l < hyperbolic-engine.js)
LORENTZ_LINES=$(wc -l < lorentz-geometry.js)
HTML_LINES=$(wc -l < hyperbolic-workspace-pro.html)

if [ "$ENGINE_LINES" -gt 3000 ]; then
  echo "  ✓ hyperbolic-engine.js: $ENGINE_LINES lines"
else
  echo "  ✗ hyperbolic-engine.js seems truncated: $ENGINE_LINES lines (expected >3000)"
  ERRORS=$((ERRORS + 1))
fi

if [ "$LORENTZ_LINES" -gt 700 ]; then
  echo "  ✓ lorentz-geometry.js: $LORENTZ_LINES lines"
else
  echo "  ✗ lorentz-geometry.js seems truncated: $LORENTZ_LINES lines (expected >700)"
  ERRORS=$((ERRORS + 1))
fi

if [ "$HTML_LINES" -gt 2000 ]; then
  echo "  ✓ hyperbolic-workspace-pro.html: $HTML_LINES lines"
else
  echo "  ✗ hyperbolic-workspace-pro.html seems truncated: $HTML_LINES lines (expected >2000)"
  ERRORS=$((ERRORS + 1))
fi

# 6. Check script references
echo ""
echo "▶ Checking script references in HTML..."
if grep -q 'src="lorentz-geometry.js"' hyperbolic-workspace-pro.html; then
  echo "  ✓ lorentz-geometry.js referenced"
else
  echo "  ✗ lorentz-geometry.js not referenced"
  ERRORS=$((ERRORS + 1))
fi

if grep -q 'src="hyperbolic-engine.js"' hyperbolic-workspace-pro.html; then
  echo "  ✓ hyperbolic-engine.js referenced"
else
  echo "  ✗ hyperbolic-engine.js not referenced"
  ERRORS=$((ERRORS + 1))
fi

if grep -q 'src="geometry-extensions.js"' hyperbolic-workspace-pro.html; then
  echo "  ✓ geometry-extensions.js referenced"
else
  echo "  ✗ geometry-extensions.js not referenced"
  ERRORS=$((ERRORS + 1))
fi

# 7. Check geometry-extensions.js syntax
if [ -f geometry-extensions.js ]; then
  if node --check geometry-extensions.js 2>/dev/null; then
    LINES=$(wc -l < geometry-extensions.js)
    echo "  ✓ geometry-extensions.js: $LINES lines"
  else
    echo "  ✗ geometry-extensions.js has syntax errors"
    ERRORS=$((ERRORS + 1))
  fi
fi

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════"
if [ $ERRORS -eq 0 ]; then
  echo "  ✓ VALIDATION PASSED - Ready to deploy"
  exit 0
else
  echo "  ✗ VALIDATION FAILED - $ERRORS error(s) found"
  exit 1
fi
