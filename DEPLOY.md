# Umbra Deployment Guide

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        DOMAINS                               │
├─────────────────────────────────────────────────────────────┤
│  umbra.hyperstitious.art     │  vespers.raindesk.dev       │
│  ─────────────────────────   │  ─────────────────────────  │
│  Main hyperbolic workspace   │  Mathematical playgrounds    │
│  6 knowledge domains         │  7 interactive explorations  │
└─────────────────────────────────────────────────────────────┘
```

## File Manifest

### Umbra (umbra.hyperstitious.art)

| File | Purpose | Size |
|------|---------|------|
| `hyperbolic-workspace-pro.html` | Main entry point | 2362 lines |
| `hyperbolic-engine.js` | Core visualization engine | 3686 lines |
| `lorentz-geometry.js` | H^n mathematics | 733 lines |

### Vespers (vespers.raindesk.dev)

| File | Purpose | Size |
|------|---------|------|
| `index.html` | Landing page | ~340 lines |
| `tensor.html` | Einsum builder | 910 lines |
| `hyperbolic.html` | Poincaré/Lorentz visualizer | 1171 lines |
| `attention.html` | Transformer attention | 940 lines |
| `ga.html` | Geometric algebra | 1333 lines |
| `proofs.html` | Proof tree composer | 1178 lines |
| `linguistics.html` | Semitic languages | 1201 lines |
| `category-computation.html` | HoTT refl loops | 1422 lines |

---

## Deployment Methods

### Method 1: Direct Copy (Current)

```bash
# From local machine to server
rsync -avz --delete \
  /home/uprootiny/jan2026/umbra/ \
  user@server:/var/www/umbra.hyperstitious.art/

rsync -avz --delete \
  /home/uprootiny/jan2026/vespers/ \
  user@server:/var/www/vespers.raindesk.dev/
```

### Method 2: Git-based Deploy

```bash
# On server, set up bare repo
mkdir -p /var/repos/umbra.git
cd /var/repos/umbra.git
git init --bare

# Add post-receive hook
cat > hooks/post-receive << 'EOF'
#!/bin/bash
GIT_WORK_TREE=/var/www/umbra.hyperstitious.art git checkout -f main
echo "Deployed to umbra.hyperstitious.art"
EOF
chmod +x hooks/post-receive

# On local machine
git remote add deploy user@server:/var/repos/umbra.git
git push deploy main
```

### Method 3: GitHub Actions (Recommended)

See `.github/workflows/deploy.yml` below.

---

## Caddy Configuration

### Umbra

```caddyfile
umbra.hyperstitious.art {
    root * /var/www/umbra.hyperstitious.art
    file_server
    encode gzip

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
        Cache-Control "public, max-age=3600"
    }

    # SPA fallback (if needed)
    try_files {path} /hyperbolic-workspace-pro.html
}
```

### Vespers

```caddyfile
vespers.raindesk.dev {
    root * /var/www/vespers.raindesk.dev
    file_server
    encode gzip

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
        Cache-Control "public, max-age=3600"
    }
}
```

---

## Validation Checklist

Run before each deploy:

```bash
# 1. Syntax check
node --check hyperbolic-engine.js
node --check lorentz-geometry.js

# 2. DOM element verification
./scripts/validate-dom.sh

# 3. All domains present
grep -E "^\s+(studies|infra|github|notes|math|langs):" hyperbolic-engine.js

# 4. File sizes (detect accidental truncation)
wc -l hyperbolic-engine.js  # Should be ~3686
wc -l lorentz-geometry.js   # Should be ~733
```

---

## Rollback

```bash
# Keep last 3 versions
DEPLOY_DIR=/var/www/umbra.hyperstitious.art
BACKUP_DIR=/var/backups/umbra

# Before deploy, backup current
cp -r $DEPLOY_DIR $BACKUP_DIR/$(date +%Y%m%d_%H%M%S)

# To rollback
ls -lt $BACKUP_DIR  # Find desired version
cp -r $BACKUP_DIR/YYYYMMDD_HHMMSS/* $DEPLOY_DIR/
```

---

## Environment Variables

None required. All configuration is in JavaScript.

---

## Health Check

After deploy, verify:

1. [ ] https://umbra.hyperstitious.art loads
2. [ ] All 6 domains switch correctly (press 1-6)
3. [ ] Command palette opens (⌘K)
4. [ ] Nodes render in disk
5. [ ] Minimap shows overview
6. [ ] Fold gesture works (select, press F)
7. [ ] Witness cut works (Shift+W)

For Vespers:
1. [ ] https://vespers.raindesk.dev loads
2. [ ] All 7 playground cards visible
3. [ ] Each playground loads without console errors

---

## Monitoring

### Basic uptime check

```bash
curl -s -o /dev/null -w "%{http_code}" https://umbra.hyperstitious.art
# Should return 200
```

### Content check

```bash
curl -s https://umbra.hyperstitious.art/hyperbolic-engine.js | head -1
# Should show: // ════════════════════════════════════════════════════════════════════════════
```
