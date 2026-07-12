#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

MACHINE="$1"
shift -- 1

printf -- '%s=%s\n' 'ENV_MACHINE' "${MACHINE@Q}"

for F in "$@"; do
  if ! [[ -s $F ]]; then
    continue
  fi
  case "$F" in
  *.env)
    sed -E -e '/^[[:space:]]*#/d' -- "$F"
    shift -- 1
    ;;
  *.json)
    jq --raw-output 'to_entries[] | "\(.key)=\(.value | if type == "array" then join(",") else . end)"' "$F"
    shift -- 1
    ;;
  *)
    set -x
    exit 1
    ;;
  esac
done
