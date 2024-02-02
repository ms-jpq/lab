#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

INPUT="$(</dev/stdin)"
JQ=(jq --exit-status)

REGION="$("${JQ[@]}" --raw-output '.region' <<<"$INPUT")"
DOMAINS="$("${JQ[@]}" '.domains | fromjson' <<<"$INPUT")"

AWS=(
  aws
  --region "$REGION"
  lightsail get-domains
)

read -r -d '' -- JQJQ <<-'EOF' || true
.domains[] | select([.name] | inside($domains)) | { (.name): ([.domainEntries[] | select(.type == "NS") | .target] | tojson) }
EOF
"${AWS[@]}" | "${JQ[@]}" --argjson domains "$DOMAINS" "$JQJQ" | "${JQ[@]}" --slurp 'add'
