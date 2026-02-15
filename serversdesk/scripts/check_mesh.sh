#!/usr/bin/env bash
set -euo pipefail

PEERS="5.189.145.105 149.102.137.139 173.212.203.211 45.90.121.59"
KEY="${MESH_KEY:-$HOME/.ssh/mesh_host_key}"
USER="${MESH_USER:-uprootiny}"
SSH_OPTS="-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5"

if [ ! -f "$KEY" ]; then
  echo "Mesh key not found at $KEY" >&2
  exit 1
fi

echo "Mesh verification starting..."
for peer in $PEERS; do
  echo "--> $peer"
  if ssh $SSH_OPTS -i "$KEY" "$USER@$peer" "hostname && echo 'OK'"; then
    echo "    [$peer] OK"
  else
    echo "    [$peer] FAIL" >&2
  fi
done
echo "Mesh verification complete."
