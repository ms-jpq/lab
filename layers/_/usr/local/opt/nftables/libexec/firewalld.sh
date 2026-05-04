#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

nft --optimize "$@" -- 'include "/usr/local/opt/nftables/conf.d/*.nft";'
nft --optimize "$@" -- 'include "/usr/local/opt/nftables/dropin.d/*.nft";'

mkdir -v -p -- '/run/local/nftables'
nft --optimize "$@" -- 'include "/run/local/nftables/*.nft";'
