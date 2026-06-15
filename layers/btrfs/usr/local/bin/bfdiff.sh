#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

case $# in
1)
  LINES="$(zfs list -t snapshot -o name -H -- "$@" | tail --lines 2)"
  readarray -t -- LR <<< "$LINES"
  LHS="${LR[0]}"
  RHS="${LR[1]}"
  ;;
2)
  NAME="$1"
  shift -- 1
  LHS="$NAME$*"
  RHS="$(zfs list -t snapshot -o name -H -- "$NAME" | tail --lines 1)"
  ;;
3)
  NAME="$1"
  shift -- 1
  LHS="$NAME$1"
  RHS="$NAME$2"
  ;;
*)
  set -x
  exit 1
  ;;
esac

exec -- btrfs send --no-data -p -- "$LHS" "$RHS"
