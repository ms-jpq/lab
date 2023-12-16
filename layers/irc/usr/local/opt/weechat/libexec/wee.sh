#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

HOME=/var/lib/local/weechat
RUNTIME="/run/local/weechat"
ENV=(
  TERM=tmux-256color
  HOME="$HOME"
  WEECHAT_HOME="$HOME/config:$HOME/data:$RUNTIME:/var/tmp"
)

export -- "${ENV[@]}"
mkdir -v -p -- "$HOME" "$RUNTIME"

if [[ -v INVOCATION_ID ]]; then
  EXEC=(dtach -N "$RUNTIME/dtach.sock")
else
  EXEC=()
fi

PATH="/var/cache/local/weechat/bin:$PATH"
exec -- "${EXEC[@]}" weechat
