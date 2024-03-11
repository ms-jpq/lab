#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if ! systemd-notify --booted; then
  exit 0
fi

for SVC in "$@"; do
  if systemctl list-units --all --output json -- "$SVC" | jq --exit-status '.[]'; then
    systemctl try-reload-or-restart -- "$SVC"
  fi
done
