#!/bin/bash
# Umbra Deployment Script
# Deploys to umbra.hyperstitious.art and optionally vespers.raindesk.dev

set -e
cd "$(dirname "$0")/.."

# Configuration
UMBRA_HOST="${UMBRA_HOST:-user@server}"
UMBRA_PATH="${UMBRA_PATH:-/var/www/umbra.hyperstitious.art}"
VESPERS_PATH="${VESPERS_PATH:-/var/www/vespers.raindesk.dev}"
VESPERS_LOCAL="${VESPERS_LOCAL:-/home/uprootiny/jan2026/vespers}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "═══════════════════════════════════════════════════════════"
echo "  UMBRA DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Parse arguments
DEPLOY_UMBRA=false
DEPLOY_VESPERS=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --umbra)
      DEPLOY_UMBRA=true
      shift
      ;;
    --vespers)
      DEPLOY_VESPERS=true
      shift
      ;;
    --all)
      DEPLOY_UMBRA=true
      DEPLOY_VESPERS=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --umbra     Deploy umbra.hyperstitious.art"
      echo "  --vespers   Deploy vespers.raindesk.dev"
      echo "  --all       Deploy both"
      echo "  --dry-run   Show what would be deployed without doing it"
      echo ""
      echo "Environment variables:"
      echo "  UMBRA_HOST  SSH host (default: user@server)"
      echo "  UMBRA_PATH  Remote path for umbra"
      echo "  VESPERS_PATH Remote path for vespers"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

if [ "$DEPLOY_UMBRA" = false ] && [ "$DEPLOY_VESPERS" = false ]; then
  echo "No target specified. Use --umbra, --vespers, or --all"
  echo "Run $0 --help for usage"
  exit 1
fi

# Step 1: Validate
echo "▶ Running validation..."
if ./scripts/validate.sh; then
  echo ""
else
  echo -e "${RED}Validation failed. Aborting deployment.${NC}"
  exit 1
fi

# Step 2: Prepare file lists
UMBRA_FILES=(
  "hyperbolic-workspace-pro.html"
  "hyperbolic-engine.js"
  "lorentz-geometry.js"
  "geometry-extensions.js"
)

# Step 3: Deploy Umbra
if [ "$DEPLOY_UMBRA" = true ]; then
  echo ""
  echo "▶ Deploying to umbra.hyperstitious.art..."
  echo "  Host: $UMBRA_HOST"
  echo "  Path: $UMBRA_PATH"
  echo "  Files: ${UMBRA_FILES[*]}"
  echo ""

  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY RUN] Would execute:${NC}"
    echo "  rsync -avz --delete ${UMBRA_FILES[*]} $UMBRA_HOST:$UMBRA_PATH/"
  else
    # Backup on remote first
    ssh "$UMBRA_HOST" "mkdir -p /var/backups/umbra && cp -r $UMBRA_PATH /var/backups/umbra/\$(date +%Y%m%d_%H%M%S)" 2>/dev/null || echo "  (backup skipped - dir may not exist)"

    # Deploy
    rsync -avz "${UMBRA_FILES[@]}" "$UMBRA_HOST:$UMBRA_PATH/"

    echo -e "${GREEN}  ✓ Deployed to umbra.hyperstitious.art${NC}"
  fi
fi

# Step 4: Deploy Vespers
if [ "$DEPLOY_VESPERS" = true ]; then
  echo ""
  echo "▶ Deploying to vespers.raindesk.dev..."
  echo "  Host: $UMBRA_HOST"
  echo "  Path: $VESPERS_PATH"
  echo "  Local: $VESPERS_LOCAL"
  echo ""

  if [ ! -d "$VESPERS_LOCAL" ]; then
    echo -e "${RED}Vespers local directory not found: $VESPERS_LOCAL${NC}"
    exit 1
  fi

  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY RUN] Would execute:${NC}"
    echo "  rsync -avz --delete $VESPERS_LOCAL/ $UMBRA_HOST:$VESPERS_PATH/"
  else
    # Deploy
    rsync -avz --delete "$VESPERS_LOCAL/" "$UMBRA_HOST:$VESPERS_PATH/"

    echo -e "${GREEN}  ✓ Deployed to vespers.raindesk.dev${NC}"
  fi
fi

# Step 5: Health check
echo ""
echo "▶ Running health checks..."

if [ "$DEPLOY_UMBRA" = true ] && [ "$DRY_RUN" = false ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://umbra.hyperstitious.art" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo -e "  ${GREEN}✓ umbra.hyperstitious.art responding (HTTP $HTTP_CODE)${NC}"
  else
    echo -e "  ${YELLOW}⚠ umbra.hyperstitious.art returned HTTP $HTTP_CODE${NC}"
  fi
fi

if [ "$DEPLOY_VESPERS" = true ] && [ "$DRY_RUN" = false ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://vespers.raindesk.dev" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo -e "  ${GREEN}✓ vespers.raindesk.dev responding (HTTP $HTTP_CODE)${NC}"
  else
    echo -e "  ${YELLOW}⚠ vespers.raindesk.dev returned HTTP $HTTP_CODE${NC}"
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo -e "${GREEN}  DEPLOYMENT COMPLETE${NC}"
echo "═══════════════════════════════════════════════════════════"
