#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

BIN=(gmake curl jq)
PKG=(make curl jq)

if ! hash -- "${BIN[@]}"; then
  sudo -- apt-get update
  DEBIAN_FRONTEND=noninteractive sudo --preserve-env -- apt-get install --no-install-recommends --yes -- "${PKG[@]}"
fi
