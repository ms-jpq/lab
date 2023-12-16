#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

# if [[ -v TZ ]]; then
#   printf -- '%s\n' "/set env TZ $TZ" >/run/local/weechat/weechat_fifo_*
# fi

exec -- dtach -a /run/local/weechat/dtach.sock -e '^g'
