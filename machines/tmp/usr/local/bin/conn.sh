#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

# shellcheck disable=SC1091
source -- /var/tmp/local/vpn/secret.env

# shellcheck disable=2154
nordvpn login --token "$NORD_VPN_TOKEN" || true
# shellcheck disable=2154
nordvpn connect "$NORD_VPN_REGION"
