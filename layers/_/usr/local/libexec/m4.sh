#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

O=()
S=0
A=()

while (($#)); do
  case "$1" in
  --)
    S=1
    ;;
  -*)
    if ((S)); then
      A+=("$1")
    else
      O+=("$1")
    fi
    ;;
  *)
    A+=("$1")
    ;;
  esac
  shift -- 1
done

H="$(realpath -- "$0")"
exec -- m4 --fatal-warnings --prefix-builtins "${O[@]}" -- "${H%/*}/../include/m4"/*.m4 "${A[@]}"
