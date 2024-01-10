#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

MACHINE="$1"
shift -- 1

printf -- '%s=%q\n' 'ENV_MACHINE' "$MACHINE"

set -x
for F in "$@"; do
  if ! [[ -s "$F" ]]; then
    continue
  fi
  case "$F" in
  *.env)
    grep -h -v -- '^#' "$F"
    shift -- 1
    ;;
  *.json)
    jq --exit-status --raw-output 'to_entries[] | "\(.key)=\(.value | if type == "array" then join(",") else . end)"' "$F"
    shift -- 1
    ;;
  *)
    set -x
    exit 1
    ;;
  esac
done
