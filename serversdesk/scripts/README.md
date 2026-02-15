# Verification helpers

These scripts automate the remaining steps that need outbound SSH/DNS/TLS access:

1. `check_mesh.sh` – runs passwordless SSH commands across **5.189.145.105**, **149.102.137.139**, **173.212.203.211**, and **45.90.121.59** using the mesh key (`~/.ssh/mesh_host_key`). Adjust `$MESH_USER` or `$MESH_KEY` as needed before running; the script prints each peer’s hostname and OK/FAIL state.
2. `check_frontdoor.sh` – curls key hostnames (status, plates hubs, architecture) through the front door (`149.102.137.139`) to verify TLS/ACME continuity; failures are logged to stderr so you can inspect Caddy logs.

The DNS update helper `porkbun-update.sh` remains the canonical tool for pushing A records. Run these scripts **before and after** DNS/ACME changes to ensure the mesh and TLS front door stay healthy.
