#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

INPUT="$(</dev/stdin)"
JQ=(jq --exit-status)

REGION="$("${JQ[@]}" --raw-output '.region' <<<"$INPUT")"
DISKS="$("${JQ[@]}" '.disks | fromjson' <<<"$INPUT")"

AWS=(
  aws
  --region "$REGION"
  lightsail get-disks
)

read -r -d '' -- JQJQ <<-'EOF' || true
[.disks[] | select([.name] | inside($disks)) | { (.name): (. | tojson) }] | add // {}
EOF
"${AWS[@]}" | "${JQ[@]}" --argjson disks "$DISKS" "$JQJQ"
