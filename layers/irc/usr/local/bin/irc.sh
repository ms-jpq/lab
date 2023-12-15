#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

exec -- dtach -a /run/local/weechat/dtach.sock -e '^g'
