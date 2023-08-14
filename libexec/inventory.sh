#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

ACTION="$1"
shift -- 1

case "$ACTION" in
gen)
  ACC='{}'
  for m in machines/*; do
    m="${m#*/}"
    ACC="$(jq --exit-status --arg key "$m" --argjson val '{}' '.[$key] = $val' <<<"$ACC")"
  done
  printf -- '%s\n' "$ACC"
  ;;
ls)
  INVENTORY="$1"
  if [[ -f "$INVENTORY" ]]; then
    jq --exit-status --raw-output '. // {} | keys[]' "$INVENTORY"
  fi
  ;;
*)
  ./libexec/inventory.jq
  exit 2
  ;;
esac
