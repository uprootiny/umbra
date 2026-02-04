# Plate Briefs

## Plate: Four-Host SSH Mesh (mesh_key + mesh_host_key)

Historical framework
- Lineage: rsh/rlogin -> ssh-1 -> ssh-2 (RFC 4251-4254) with public key auth (RFC 4252).
- Security migration: password-based remote shells -> key-based auth, host key verification, TOFU.
- Operational pattern: mesh of mutually trusted nodes (complete graph) for automation and fault tolerance.

Concept vocabulary (formal-ish)
- Host: a node identified by IP or DNS label. Let H be the set of hosts.
- Keypair: (sk, pk), where sk is the private key and pk is public key, pk = G * sk over ed25519.
- Authorized set: for host h, A_h is the set of public keys allowed to authenticate into h.
- Two-way passwordless link: for hosts a,b in H, a->b is valid if pk_a in A_b and a possesses sk_a.
- Complete mesh: for all distinct a,b in H, link(a,b) holds.

Non-trivial theorems (operational)
- Theorem (Mesh completeness): If each host h generates a unique keypair (sk_h, pk_h) and for all h, A_h contains {pk_k | k in H, k != h}, then the directed graph of passwordless SSH is complete.
- Theorem (Host-key integrity): If host keys are pinned in known_hosts and remote host keys change, then an interactive integrity failure must be resolved before a safe session can be established.
- Theorem (Key separation): Using a distinct mesh key for inter-host links reduces the blast radius of client key compromise; removal of a single pk_h from all A_* revokes h without touching other access.

Didactic narrative
A mesh begins with individual identity: each host carries a private key that never leaves. It presents the public half to peers. The peer keeps this public half as a token of trust. When h connects to k, the cryptographic dance proves knowledge of sk_h without revealing it. A complete mesh is the repetition of this ritual for every pair. The barrier is not cryptography but logistics: placement of the right tokens into each authorized set and verification of host identity through host keys.

Protocol steps (SSH auth, bits and boundaries)
- Transport: TCP/22; version exchange; key exchange (curve25519-sha256) -> shared secret; session keys derived.
- Host authentication: server proves possession of host private key, client checks known_hosts fingerprint.
- User authentication: client signs a challenge with sk_h; server verifies with pk_h in authorized_keys.
- Mutating bits:
  - known_hosts: records host keys (host -> public host key).
  - authorized_keys: appends pk_h lines for new trust relationships.
- Boundary acknowledgement: change in host key is treated as potential MITM unless explicitly updated.

Usage examples
- Generate per-host key:
  - ssh-keygen -t ed25519 -f ~/.ssh/mesh_host_key -N '' -C 'host@mesh'
- Add pk to peer:
  - echo 'ssh-ed25519 AAAA... host@mesh' >> ~/.ssh/authorized_keys
- Verify link:
  - ssh -i ~/.ssh/mesh_host_key -o BatchMode=yes user@peer 'echo OK'

Worked example (4-host mesh)
- Let H = {finml, hub2, hyle, karlsruhe}.
- Each host generates pk_finml, pk_hub2, pk_hyle, pk_karlsruhe.
- For each host h, authorized_keys contains the other three public keys.
- Validate all 12 directed edges succeed with BatchMode.

Marginality (risks and corrections)
- Risk: host key mismatch -> session blocked. Correction: update known_hosts after out-of-band verification.
- Risk: shared key used for multiple roles -> lateral compromise. Correction: rotate and split keys per role.
- Risk: authorized_keys sprawl -> stale trust. Correction: inventory and prune regularly.

Learning hints
- Treat authorized_keys as a whitelist of identities; never share private keys.
- Mesh validation is a graph problem: count edges.


## Plate: Mesh Witness Cycle (mesh-ping)

Historical framework
- Lineage: cron-driven health checks -> distributed heartbeat -> gossip protocols.
- Operational shift: from constant polling to deterministic sampling to reduce compute and network noise.

Concept vocabulary
- Peer set P: set of peer IPs.
- Witness cycle: each host checks exactly one peer per interval, rotating deterministically.
- Status ledger: map peer -> (status, timestamp).

Non-trivial theorems
- Theorem (Coverage): If each host checks one peer per minute with rotation period |P|-1, each peer is witnessed at least once per cycle on each host.
- Theorem (Noise bound): With N hosts, total SSH pings per minute is N*(N-1)/(|P|-1) = N, constant per host per minute.

Didactic narrative
A full mesh check every minute is wasteful. The witness cycle transforms it into a ritual: each host chooses a single peer per minute based on a shared schedule. Over time, the ledger becomes complete, but each tick is light.

Protocol steps (ritualized)
- Determine self IPs; remove them from P.
- Choose peer index = floor(time/60) mod count.
- Perform SSH probe with short timeout.
- Update the single line in the status ledger.

Usage example
- Run: /home/uprootiny/.local/bin/mesh-ping
- Output: ~/.mesh/peers.status

Marginality
- Risk: time skew -> different rotations. Correction: enable NTP.
- Risk: host down -> consistent FAIL; the ledger reveals the pattern.

Learning hints
- Use deterministic jitter to avoid synchronized load spikes.


## Plate: TLS Front Door + Reverse Proxy (Caddy)

Historical framework
- Lineage: HTTP -> HTTPS (TLS), reverse proxies as service multiplexers.
- Automation: ACME (RFC 8555) allows automated certificate issuance via HTTP-01.
- Operational pattern: single TLS entrypoint with upstream routing by Host header.

Concept vocabulary
- Front door: a proxy that terminates TLS and forwards to upstreams.
- Host routing: mapping from SNI/Host to upstream target.
- Certificate: X.509 cert binding domain to public key, issued by CA.
- ACME HTTP-01: proof of control by serving a token at .well-known/acme-challenge.

Non-trivial theorems
- Theorem (TLS termination): If the proxy presents a valid cert for host H and forwards requests to upstream U, end-to-end confidentiality is between client and proxy; upstream is trusted boundary.
- Theorem (ACME reachability): For HTTP-01, DNS must point to the proxy so the CA can fetch tokens.

Didactic narrative
TLS is a rite of passage: the proxy proves to the CA that it controls the domain. Once blessed, it becomes the gatekeeper for all requests. The upstreams no longer need their own public certs; they speak plain HTTP behind the gate.

Protocol steps (ACME)
- Client -> proxy: SNI=host, HTTPS handshake.
- Proxy -> CA: request certificate.
- CA -> proxy: HTTP-01 challenge (GET /.well-known/acme-challenge/...).
- Proxy serves token; CA validates and issues cert.

Usage examples
- Caddy host stanza:
  - example.raindesk.dev { reverse_proxy 173.212.203.211:80 }
- Bulk TLS: explicit hostnames listed for auto-issuance.

Marginality
- Risk: wildcard without DNS-01 means no cert. Correction: list explicit hosts or implement DNS-01.
- Risk: upstream 500s surface as TLS failures to users. Correction: validate upstream health.

Learning hints
- TLS success depends on DNS; check A records first.


## Plate: Porkbun DNS Updates (Local Script)

Historical framework
- Lineage: manual DNS -> provider APIs -> infrastructure as code.
- Namespaces: apex records, subdomain records, wildcard records.

Concept vocabulary
- Zone: a domain managed by a DNS provider.
- A record: maps a name to an IPv4 address.
- Apex: root record '@' representing the domain itself.
- Wildcard: '*' record matching any subdomain not explicitly defined.

Non-trivial theorems
- Theorem (Wildcard shadowing): If a specific subdomain record exists, it overrides the wildcard.
- Theorem (Propagation): DNS changes are eventually consistent; TTL bounds caching delay.

Didactic narrative
DNS is a ledger of names. The ritual is edit -> propagate -> wait. APIs allow systematic ceremony: query existing record, then edit if it exists, else create. The sacred rule: do not leak credentials.

Protocol steps (API)
- Client posts JSON payload with API key and secret.
- Server returns records with IDs.
- Client edits or creates record.

Usage examples
- Script: /home/uprootiny/jan2026/umbra/serversdesk/porkbun-update.sh
- Env: PORKBUN_API_KEY, PORKBUN_SECRET_KEY, TARGET_IP

Marginality
- Risk: leaked credentials -> domain takeover. Correction: rotate keys, keep local.
- Risk: wrong target IP -> blackhole. Correction: verify IP with whois + host checks.

Learning hints
- Use apex + wildcard to cover most names, then override as needed.

