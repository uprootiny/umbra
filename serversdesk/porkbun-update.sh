#!/usr/bin/env bash
set -euo pipefail

if [ -z "${PORKBUN_API_KEY:-}" ] || [ -z "${PORKBUN_SECRET_KEY:-}" ]; then
  echo "Set PORKBUN_API_KEY and PORKBUN_SECRET_KEY in your environment." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for JSON parsing." >&2
  exit 1
fi

API_BASE="https://porkbun.com/api/json/v3/dns"
TARGET_IP="${TARGET_IP:-149.102.137.139}"
TTL="${TTL:-600}"

porkbun_call() {
  local endpoint="$1"
  local payload="$2"
  curl -sS -X POST "${API_BASE}/${endpoint}" \
    -H 'Content-Type: application/json' \
    -d "${payload}"
}

get_record_id() {
  local domain="$1"
  local name="$2"
  local type="$3"
  local json
  json=$(porkbun_call "retrieveRecords/${domain}" "{\"apikey\":\"${PORKBUN_API_KEY}\",\"secretapikey\":\"${PORKBUN_SECRET_KEY}\"}")
  python3 - "$domain" "$name" "$type" <<<"$json" <<'PY'
import json, sys
domain = sys.argv[1]
name = sys.argv[2]
type_ = sys.argv[3]
data = json.loads(sys.stdin.read() or "{}")
records = data.get("records") or []
for rec in records:
    rec_name = rec.get("name") or ""
    if rec.get("type") != type_:
        continue
    if rec_name == name:
        print(rec.get("id") or "")
        break
    if name == "@" and rec_name == domain:
        print(rec.get("id") or "")
        break
    if name != "@" and rec_name == f"{name}.{domain}":
        print(rec.get("id") or "")
        break
PY
}

upsert_a() {
  local domain="$1"
  local name="$2"
  local payload_base
  local record_id

  payload_base="{\"apikey\":\"${PORKBUN_API_KEY}\",\"secretapikey\":\"${PORKBUN_SECRET_KEY}\",\"type\":\"A\",\"name\":\"${name}\",\"content\":\"${TARGET_IP}\",\"ttl\":\"${TTL}\"}"
  record_id=$(get_record_id "$domain" "$name" "A")

  if [ -n "${record_id}" ]; then
    porkbun_call "editRecord/${domain}/${record_id}" "${payload_base}" >/dev/null
    echo "Updated A ${name}.${domain} -> ${TARGET_IP}"
  else
    porkbun_call "createRecord/${domain}" "${payload_base}" >/dev/null
    echo "Created A ${name}.${domain} -> ${TARGET_IP}"
  fi
}

# Domains and records
upsert_a "raindesk.dev" "@"
upsert_a "raindesk.dev" "*"

upsert_a "raindeck.dev" "@"
upsert_a "raindeck.dev" "*"

upsert_a "hyperstitious.art" "@"
upsert_a "hyperstitious.art" "*"

upsert_a "hyperstitious.org" "@"
upsert_a "hyperstitious.org" "*"

upsert_a "dissemblage.art" "@"
upsert_a "dissemblage.art" "*"

upsert_a "hyle.lol" "@"

echo "Done."
