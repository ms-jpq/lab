#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

JQ=(jq --exit-status)
SSH_KEYS="$("${JQ[@]}" --raw-output '.ssh_keys | fromjson | .[]')"

printf -v KEYS -- '%q\n' "$SSH_KEYS"
SCRIPT="$(<"${0%/*}/cloud-init.sh")"
B64="$(base64 --wrap 0 <<<"SSH_KEYS=$KEYS $SCRIPT")"

read -r -d '' -- BASH <<-EOF || true
printf -- %s $B64 | base64 --decode | bash
EOF

"${JQ[@]}" --raw-input '{ script: . }' <<<"$BASH"
