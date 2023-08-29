#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

systemctl daemon-reload --no-pager --show-transaction
FAILED="$(systemctl --output json --failed | jq --raw-output '.[].unit')"
readarray -t -- US <<<"$FAILED"
UNITS=()
for U in "${US[@]}"; do
  if [[ -n "$U" ]]; then
    UNITS+=("$U")
  fi
done
if ((${#UNITS[@]})); then
  /usr/local/libexec/hr-run.sh systemctl restart --no-pager --show-transaction -- "${UNITS[@]}"
fi
