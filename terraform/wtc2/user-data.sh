#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

INPUT="$(</dev/stdin)"
JQ=(jq --exit-status)

SSH_KEYS="$("${JQ[@]}" --raw-output '.ssh_keys | fromjson | .[]' <<<"$INPUT")"
HOSTNAME="$("${JQ[@]}" --raw-output '.hostname' <<<"$INPUT")"

printf -v KEYS -- '%q\n' "$SSH_KEYS"
printf -v HOST -- '%q\n' "$HOSTNAME"
SCRIPT="$(cat -- "${0%/*}/cloud-init"/*.sh)"

B64="$(base64 --wrap 0 <<<"SSH_KEYS=${KEYS}HOSTNAME=${HOST}$SCRIPT")"

read -r -d '' -- BASH <<-EOF || true
printf -- %s $B64 | base64 --decode | bash
EOF

"${JQ[@]}" --raw-input '{ script: . }' <<<"$BASH"
