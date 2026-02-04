#!/bin/bash
# Umbra Hyperbolic Workspace - Deployment Script
# Domain: umbra.hyperstitious.art

set -e

UMBRA_DIR="/home/uprootiny/jan2026/umbra"
DOMAIN="umbra.hyperstitious.art"

echo "=== Umbra Deployment ==="

# Check if running as root for Caddy operations
check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo "Some operations require sudo. You may be prompted."
    fi
}

# Install Caddy if not present
install_caddy() {
    if ! command -v caddy &> /dev/null; then
        echo "Installing Caddy..."
        sudo apt-get update
        sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
        sudo apt-get update
        sudo apt-get install -y caddy
    else
        echo "Caddy already installed: $(caddy version)"
    fi
}

# Configure Caddy
configure_caddy() {
    echo "Configuring Caddy for $DOMAIN..."
    sudo tee /etc/caddy/Caddyfile > /dev/null << EOF
$DOMAIN {
    root * $UMBRA_DIR
    file_server
    encode gzip

    # Default to hyperbolic-workspace-pro.html
    try_files {path} /hyperbolic-workspace-pro.html
}
EOF
    echo "Caddyfile written."
}

# Set permissions
fix_permissions() {
    echo "Setting file permissions..."
    chmod o+rx /home/uprootiny /home/uprootiny/jan2026 "$UMBRA_DIR"
    chmod o+r "$UMBRA_DIR"/*
    echo "Permissions set."
}

# Reload/restart Caddy
reload_caddy() {
    echo "Reloading Caddy..."
    sudo systemctl reload caddy || sudo systemctl restart caddy
    sleep 2
    if systemctl is-active --quiet caddy; then
        echo "Caddy is running."
    else
        echo "ERROR: Caddy failed to start!"
        sudo systemctl status caddy --no-pager
        exit 1
    fi
}

# Verify deployment
verify() {
    echo "Verifying deployment..."

    # Check HTTPS
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo "✓ https://$DOMAIN returns 200"
    else
        echo "✗ https://$DOMAIN returns $HTTP_CODE"
    fi

    # Check JS file
    JS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/hyperbolic-engine.js" 2>/dev/null || echo "000")
    if [ "$JS_CODE" = "200" ]; then
        echo "✓ hyperbolic-engine.js accessible"
    else
        echo "✗ hyperbolic-engine.js returns $JS_CODE"
    fi

    # Check TLS certificate
    echo "TLS Certificate:"
    echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null || echo "  (could not verify)"
}

# Status check
status() {
    echo "=== Umbra Status ==="
    echo "Domain: https://$DOMAIN"
    echo "Root: $UMBRA_DIR"
    echo ""
    echo "Files:"
    ls -la "$UMBRA_DIR"/*.html "$UMBRA_DIR"/*.js 2>/dev/null | awk '{print "  " $9 " (" $5 " bytes)"}'
    echo ""
    echo "Caddy:"
    systemctl status caddy --no-pager | head -5
    echo ""
    verify
}

# Main
case "${1:-deploy}" in
    install)
        check_root
        install_caddy
        ;;
    configure)
        check_root
        configure_caddy
        fix_permissions
        reload_caddy
        ;;
    deploy)
        check_root
        install_caddy
        configure_caddy
        fix_permissions
        reload_caddy
        verify
        ;;
    verify)
        verify
        ;;
    status)
        status
        ;;
    *)
        echo "Usage: $0 {deploy|install|configure|verify|status}"
        exit 1
        ;;
esac

echo ""
echo "=== Done ==="
