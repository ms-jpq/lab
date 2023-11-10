#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

/usr/local/libexec/hr-run.sh nft --optimize "$@" -- 'include "/usr/local/opt/nftables/conf.d/*.conf";'
/usr/local/libexec/hr-run.sh nft --optimize "$@" -- 'include "/usr/local/opt/nftables/dropin.d/*.conf";'

mkdir -v -p -- '/run/local/nftables'
/usr/local/libexec/hr-run.sh nft --optimize "$@" -- 'include "/run/local/nftables/*.conf";'
