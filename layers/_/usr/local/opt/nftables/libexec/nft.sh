#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

/usr/local/libexec/hr-run.sh nft --optimize "$@" -- 'include "/usr/local/lib/nftables/conf.d/*.conf";'
/usr/local/libexec/hr-run.sh nft --service --guid -- 'list ruleset'

/usr/local/libexec/hr-run.sh nft --optimize "$@" -- 'include "/usr/local/lib/nftables/dropin.d/*.conf";'
/usr/local/libexec/hr-run.sh nft --service --guid -- 'list ruleset'
