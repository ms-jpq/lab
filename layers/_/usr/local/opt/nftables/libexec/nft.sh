#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

hr-run nft --optimize "$@" -- 'include "/usr/local/lib/nftables/conf.d/*.conf";'
hr-run nft --service --guid -- 'list ruleset'

hr-run nft --optimize "$@" -- 'include "/usr/local/lib/nftables/dropin.d/*.conf";'
hr-run nft --service --guid -- 'list ruleset'
