#!/usr/bin/env bash
set -euo pipefail

HOSTS=(
  "status.raindesk.dev"
  "plates.raindesk.dev"
  "plates.hyperstitious.art"
  "architecture.raindesk.dev"
  "cyberspace.raindesk.dev"
  "hyperstitious.art"
  "dissemblage.art"
)

echo "Front door TLS health check"
for host in "${HOSTS[@]}"; do
  echo "--> https://$host"
  if curl -fsSl -o /dev/null "https://$host"; then
    echo "    ✓ OK"
  else
    echo "    ✗ FAIL (status or connectivity)" >&2
  fi
done
echo "Front door check complete. Use logs or Caddy to inspect failures."
