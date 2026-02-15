#!/bin/bash
# Umbra Stress Test & Extended Validation Suite
# Tests: endpoints, assets, concurrency, latency, content integrity, headers, error handling
#
# Usage: ./scripts/stress-test.sh [--quick|--full|--report]

set -uo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${UMBRA_DOMAIN:-https://umbra.hyperstitious.art}"
CONCURRENCY="${UMBRA_CONCURRENCY:-20}"
DURATION="${UMBRA_DURATION:-10}"
REPORT_DIR="test-reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="$REPORT_DIR/stress-$TIMESTAMP.txt"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
TOTAL=0

# ─────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────

check() {
  TOTAL=$((TOTAL + 1))
  local label="$1"
  local result="$2"
  local expected="${3:-}"

  if [ "$result" = "PASS" ]; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}✓${NC} $label"
  elif [ "$result" = "WARN" ]; then
    WARN=$((WARN + 1))
    echo -e "  ${YELLOW}⚠${NC} $label ${DIM}($expected)${NC}"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}✗${NC} $label ${DIM}($expected)${NC}"
  fi
}

section() {
  echo ""
  echo -e "${CYAN}▶ $1${NC}"
}

# ─────────────────────────────────────────────────────────
# 1. ENDPOINT MATRIX
# ─────────────────────────────────────────────────────────

test_endpoints() {
  section "Endpoint Matrix — All pages & assets"

  local ENDPOINTS=(
    "/|200|text/html"
    "/index.html|200|text/html"
    "/hyperbolic-workspace-pro.html|200|text/html"
    "/hyperbolic-workspace.html|200|text/html"
    "/lab.html|200|text/html"
    "/hyperbolic-map.html|200|text/html"
    "/hyperbolic-map-v2.html|200|text/html"
    "/hyperbolic-map-v3.html|200|text/html"
    "/hyperbolic-engine.js|200|application/javascript"
    "/lorentz-geometry.js|200|application/javascript"
    "/geometry-extensions.js|200|application/javascript"
    "/hyperbolic-algebra.js|200|application/javascript"
    "/hyperbolic-compute.js|200|application/javascript"
    "/hyperbolic-projections.js|200|application/javascript"
    "/hyperbolic-core.js|200|application/javascript"
    "/playgrounds/tensor.html|200|text/html"
    "/playgrounds/hyperbolic.html|200|text/html"
    "/playgrounds/attention.html|200|text/html"
    "/playgrounds/ga.html|200|text/html"
    "/playgrounds/proofs.html|200|text/html"
    "/playgrounds/linguistics.html|200|text/html"
    "/playgrounds/category-computation.html|200|text/html"
  )

  for entry in "${ENDPOINTS[@]}"; do
    IFS='|' read -r path expected_code expected_type <<< "$entry"
    local response
    response=$(curl -sL -o /dev/null -w "%{http_code}|%{content_type}|%{time_total}|%{size_download}" "$DOMAIN$path" 2>/dev/null)
    IFS='|' read -r code ctype latency size <<< "$response"

    if [ "$code" = "$expected_code" ]; then
      check "$path → ${code} (${latency}s, ${size}b)" "PASS"
    else
      check "$path → ${code} (expected ${expected_code})" "FAIL" "got $code"
    fi
  done
}

# ─────────────────────────────────────────────────────────
# 2. ERROR HANDLING
# ─────────────────────────────────────────────────────────

test_error_handling() {
  section "Error Handling — 404s, bad paths, edge cases"

  local BAD_PATHS=(
    "/nonexistent.html"
    "/../../etc/passwd"
    "/%00"
    "/playgrounds/../../../etc/shadow"
    "/<script>alert(1)</script>"
    "/hyperbolic-engine.js.bak"
    "/.env"
    "/.git/config"
  )

  for path in "${BAD_PATHS[@]}"; do
    local code
    code=$(curl -sL -o /dev/null -w "%{http_code}" "$DOMAIN$path" 2>/dev/null)
    # SPA fallback returns 200, but traversal/injection should not expose system files
    if [ "$code" != "500" ]; then
      check "$path → ${code} (no 500)" "PASS"
    else
      check "$path → 500 server error" "FAIL" "should not crash"
    fi
  done

  # Verify path traversal doesn't leak system files
  local content
  content=$(curl -sL --max-time 5 "$DOMAIN/../../etc/passwd" 2>/dev/null | head -c 200)
  if echo "$content" | grep -q "root:"; then
    check "Path traversal leaks /etc/passwd" "FAIL" "SECURITY ISSUE"
  else
    check "Path traversal blocked" "PASS"
  fi
}

# ─────────────────────────────────────────────────────────
# 3. CONTENT INTEGRITY
# ─────────────────────────────────────────────────────────

test_content_integrity() {
  section "Content Integrity — Key markers in responses"

  # Download files once to temp
  local tmpdir
  tmpdir=$(mktemp -d)
  curl -sL --max-time 10 "$DOMAIN/hyperbolic-workspace-pro.html" > "$tmpdir/workspace.html" 2>/dev/null
  curl -sL --max-time 10 "$DOMAIN/hyperbolic-engine.js" > "$tmpdir/engine.js" 2>/dev/null
  curl -sL --max-time 10 "$DOMAIN/index.html" > "$tmpdir/index.html" 2>/dev/null

  # Check main workspace has critical elements
  local MARKERS=("id=\"canvas\"" "id=\"minimap\"" "id=\"commandOverlay\"" "id=\"metricFocus\"" "id=\"metricDist\"" "hyperbolic-engine.js" "geometry-extensions.js" "Poincaré")
  for marker in "${MARKERS[@]}"; do
    if grep -q "$marker" "$tmpdir/workspace.html"; then
      check "workspace contains: $marker" "PASS"
    else
      check "workspace missing: $marker" "FAIL" "required element"
    fi
  done

  # Check engine.js contains core functions
  local JS_MARKERS=("function render" "SPACES" "switchSpace" "hypDist" "geodesic" "mobius")
  for marker in "${JS_MARKERS[@]}"; do
    if grep -q "$marker" "$tmpdir/engine.js"; then
      check "engine.js contains: $marker" "PASS"
    else
      check "engine.js missing: $marker" "FAIL" "core function"
    fi
  done

  # Check index.html landing page
  if grep -q "hyperbolic-workspace-pro" "$tmpdir/index.html"; then
    check "index.html links to workspace" "PASS"
  else
    check "index.html missing workspace link" "WARN" "should link to main workspace"
  fi

  rm -rf "$tmpdir"
}

# ─────────────────────────────────────────────────────────
# 4. RESPONSE HEADERS
# ─────────────────────────────────────────────────────────

test_headers() {
  section "Response Headers — Security & performance"

  local headers
  headers=$(curl -sI "$DOMAIN/" 2>/dev/null)

  # Check for gzip/compression
  local encoding
  encoding=$(curl -sI -H "Accept-Encoding: gzip" "$DOMAIN/hyperbolic-engine.js" 2>/dev/null | grep -i "content-encoding" || echo "")
  if echo "$encoding" | grep -qi "gzip\|br\|zstd"; then
    check "Compression enabled" "PASS"
  else
    check "No compression detected" "WARN" "enable gzip/brotli"
  fi

  # Check TLS
  local tls_info
  tls_info=$(curl -sI "$DOMAIN/" 2>/dev/null | head -1)
  if echo "$tls_info" | grep -q "HTTP/2\|HTTP/3"; then
    check "HTTP/2+ enabled" "PASS"
  elif echo "$tls_info" | grep -q "HTTP/1.1"; then
    check "Only HTTP/1.1" "WARN" "consider HTTP/2"
  fi

  # Check HTTPS redirect
  local redirect_code
  redirect_code=$(curl -s -o /dev/null -w "%{http_code}" "http://umbra.hyperstitious.art/" 2>/dev/null || echo "000")
  if [ "$redirect_code" = "301" ] || [ "$redirect_code" = "302" ] || [ "$redirect_code" = "308" ]; then
    check "HTTP → HTTPS redirect (${redirect_code})" "PASS"
  elif [ "$redirect_code" = "000" ]; then
    check "HTTP port not reachable" "WARN" "redirect recommended"
  else
    check "No HTTPS redirect (${redirect_code})" "WARN" "should redirect"
  fi
}

# ─────────────────────────────────────────────────────────
# 5. TLS CERTIFICATE
# ─────────────────────────────────────────────────────────

test_tls() {
  section "TLS Certificate"

  local cert_info
  cert_info=$(echo | openssl s_client -servername umbra.hyperstitious.art -connect umbra.hyperstitious.art:443 2>/dev/null | openssl x509 -noout -subject -dates 2>/dev/null)

  if echo "$cert_info" | grep -q "umbra.hyperstitious.art"; then
    check "Certificate matches domain" "PASS"
  else
    check "Certificate mismatch" "FAIL" "wrong cert"
  fi

  # Check expiry
  local not_after
  not_after=$(echo "$cert_info" | grep "notAfter" | cut -d= -f2)
  if [ -n "$not_after" ]; then
    local expiry_epoch
    expiry_epoch=$(date -d "$not_after" +%s 2>/dev/null || echo "0")
    local now_epoch
    now_epoch=$(date +%s)
    local days_left=$(( (expiry_epoch - now_epoch) / 86400 ))

    if [ "$days_left" -gt 14 ]; then
      check "Certificate valid for ${days_left} days" "PASS"
    elif [ "$days_left" -gt 0 ]; then
      check "Certificate expires in ${days_left} days" "WARN" "renew soon"
    else
      check "Certificate expired!" "FAIL" "renew immediately"
    fi
  fi
}

# ─────────────────────────────────────────────────────────
# 6. LATENCY BENCHMARKS
# ─────────────────────────────────────────────────────────

test_latency() {
  section "Latency Benchmarks — Response time thresholds"

  local LATENCY_TARGETS=(
    "/|0.5|landing"
    "/hyperbolic-workspace-pro.html|1.0|workspace"
    "/hyperbolic-engine.js|1.0|engine"
    "/playgrounds/tensor.html|0.5|playground"
  )

  for entry in "${LATENCY_TARGETS[@]}"; do
    IFS='|' read -r path threshold label <<< "$entry"

    # Average 3 requests
    local total=0
    for i in 1 2 3; do
      local t
      t=$(curl -sL -o /dev/null -w "%{time_total}" "$DOMAIN$path" 2>/dev/null)
      total=$(echo "$total + $t" | bc)
    done
    local avg
    avg=$(echo "scale=3; $total / 3" | bc)

    local passed
    passed=$(echo "$avg < $threshold" | bc)
    if [ "$passed" = "1" ]; then
      check "$label avg: ${avg}s (< ${threshold}s)" "PASS"
    else
      check "$label avg: ${avg}s (> ${threshold}s)" "WARN" "slow"
    fi
  done
}

# ─────────────────────────────────────────────────────────
# 7. CONCURRENT LOAD TEST
# ─────────────────────────────────────────────────────────

test_concurrent() {
  section "Concurrent Load — ${CONCURRENCY} parallel requests"

  local tmpdir
  tmpdir=$(mktemp -d)

  # Fire N concurrent requests
  for i in $(seq 1 "$CONCURRENCY"); do
    curl -sL -o /dev/null -w "%{http_code}|%{time_total}" "$DOMAIN/hyperbolic-workspace-pro.html" > "$tmpdir/$i.txt" 2>/dev/null &
  done
  wait

  local ok=0
  local total_time=0
  local max_time=0

  for f in "$tmpdir"/*.txt; do
    local code time
    IFS='|' read -r code time < "$f"
    if [ "$code" = "200" ]; then
      ok=$((ok + 1))
    fi
    total_time=$(echo "$total_time + $time" | bc)
    local is_max
    is_max=$(echo "$time > $max_time" | bc)
    if [ "$is_max" = "1" ]; then
      max_time=$time
    fi
  done

  local avg_time
  avg_time=$(echo "scale=3; $total_time / $CONCURRENCY" | bc)

  rm -rf "$tmpdir"

  if [ "$ok" = "$CONCURRENCY" ]; then
    check "All $CONCURRENCY requests succeeded" "PASS"
  else
    check "$ok/$CONCURRENCY succeeded" "FAIL" "$((CONCURRENCY - ok)) failed"
  fi

  check "Avg response: ${avg_time}s | Max: ${max_time}s" "PASS"
}

# ─────────────────────────────────────────────────────────
# 8. SUSTAINED LOAD BURST
# ─────────────────────────────────────────────────────────

test_burst() {
  section "Burst Load — 50 rapid sequential requests"

  local ok=0
  local total_time=0

  for i in $(seq 1 50); do
    local response
    response=$(curl -sL -o /dev/null -w "%{http_code}|%{time_total}" "$DOMAIN/" 2>/dev/null)
    IFS='|' read -r code time <<< "$response"
    if [ "$code" = "200" ]; then
      ok=$((ok + 1))
    fi
    total_time=$(echo "$total_time + $time" | bc)
  done

  local avg_time
  avg_time=$(echo "scale=3; $total_time / 50" | bc)

  if [ "$ok" -eq 50 ]; then
    check "50/50 burst requests OK (avg ${avg_time}s)" "PASS"
  elif [ "$ok" -ge 45 ]; then
    check "$ok/50 burst requests OK" "WARN" "$((50 - ok)) dropped"
  else
    check "$ok/50 burst requests OK" "FAIL" "too many failures"
  fi
}

# ─────────────────────────────────────────────────────────
# 9. ASSET SIZE VALIDATION
# ─────────────────────────────────────────────────────────

test_asset_sizes() {
  section "Asset Sizes — Sanity checks"

  local ASSETS=(
    "/hyperbolic-engine.js|200000|400000|main engine"
    "/lorentz-geometry.js|15000|50000|lorentz module"
    "/geometry-extensions.js|15000|50000|geometry ext"
    "/hyperbolic-workspace-pro.html|80000|200000|workspace html"
    "/index.html|3000|20000|landing page"
  )

  for entry in "${ASSETS[@]}"; do
    IFS='|' read -r path min_size max_size label <<< "$entry"
    local size
    size=$(curl -sL -o /dev/null -w "%{size_download}" "$DOMAIN$path" 2>/dev/null)

    if [ "$size" -ge "$min_size" ] && [ "$size" -le "$max_size" ]; then
      check "$label: ${size}b (expected ${min_size}-${max_size})" "PASS"
    elif [ "$size" -lt "$min_size" ]; then
      check "$label: ${size}b (< ${min_size}b min)" "FAIL" "possibly truncated"
    else
      check "$label: ${size}b (> ${max_size}b max)" "WARN" "unexpectedly large"
    fi
  done
}

# ─────────────────────────────────────────────────────────
# 10. CROSS-REFERENCE INTEGRITY
# ─────────────────────────────────────────────────────────

test_cross_references() {
  section "Cross-Reference Integrity — Script loads & links"

  # Check that all scripts referenced in workspace can be fetched
  local html
  html=$(curl -sL "$DOMAIN/hyperbolic-workspace-pro.html" 2>/dev/null)
  local scripts
  scripts=$(echo "$html" | grep -oP 'src="[^"]+\.js"' | sed 's/src="//;s/"//')

  for script in $scripts; do
    local code
    code=$(curl -sL -o /dev/null -w "%{http_code}" "$DOMAIN/$script" 2>/dev/null)
    if [ "$code" = "200" ]; then
      check "Script loads: $script" "PASS"
    else
      check "Script fails: $script → ${code}" "FAIL" "broken reference"
    fi
  done

  # Check index.html links
  local index
  index=$(curl -sL "$DOMAIN/index.html" 2>/dev/null)
  local links
  links=$(echo "$index" | grep -oP 'href="[^"]+\.html"' | sed 's/href="//;s/"//' | head -10)

  for link in $links; do
    local code
    code=$(curl -sL -o /dev/null -w "%{http_code}" "$DOMAIN/$link" 2>/dev/null)
    if [ "$code" = "200" ]; then
      check "Link resolves: $link" "PASS"
    else
      check "Broken link: $link → ${code}" "FAIL" "dead link"
    fi
  done
}

# ─────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────

echo "═══════════════════════════════════════════════════════════"
echo "  UMBRA STRESS TEST & EXTENDED VALIDATION"
echo "  Domain: $DOMAIN"
echo "  Time:   $(date)"
echo "═══════════════════════════════════════════════════════════"

MODE="${1:---full}"

case "$MODE" in
  --quick)
    test_endpoints
    test_content_integrity
    test_tls
    ;;
  --full)
    test_endpoints
    test_error_handling
    test_content_integrity
    test_headers
    test_tls
    test_latency
    test_concurrent
    test_burst
    test_asset_sizes
    test_cross_references
    ;;
  --report)
    mkdir -p "$REPORT_DIR"
    exec > >(tee "$REPORT_FILE") 2>&1
    echo "Report: $REPORT_FILE"
    test_endpoints
    test_error_handling
    test_content_integrity
    test_headers
    test_tls
    test_latency
    test_concurrent
    test_burst
    test_asset_sizes
    test_cross_references
    ;;
  *)
    echo "Usage: $0 [--quick|--full|--report]"
    exit 1
    ;;
esac

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════"
echo -e "  Results: ${GREEN}${PASS} passed${NC}  ${YELLOW}${WARN} warnings${NC}  ${RED}${FAIL} failed${NC}  (${TOTAL} total)"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}ALL TESTS PASSED${NC}"
else
  echo -e "  ${RED}${FAIL} FAILURE(S) — review above${NC}"
fi
echo "═══════════════════════════════════════════════════════════"

exit "$FAIL"
