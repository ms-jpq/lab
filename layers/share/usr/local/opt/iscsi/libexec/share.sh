#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if ! systemd-notify --booted; then
  exit 0
fi

NAME="${0##*/}"
NAME="${NAME%.*}"
sed -E -e '/^[[:space:]]*#/d' -- "${0%/*}/../$NAME.targetcli" | targetcli
