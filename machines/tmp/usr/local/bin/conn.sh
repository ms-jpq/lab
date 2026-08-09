#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

# shellcheck disable=SC1091
source -- /var/lib/local/vpn/secret.env

: "${NORD_VPN_TOKEN?}"
nordvpn login --token "$NORD_VPN_TOKEN" || true
if [[ -z ${1:-} ]]; then
  : "${NORD_VPN_REGION?}"
fi
nordvpn connect "${1:-$NORD_VPN_REGION}"
