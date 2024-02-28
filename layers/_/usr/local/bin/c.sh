#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

T=0
case "$TERM" in
tmux*)
  T=1
  ;;
*) ;;
esac

if ((T)); then
  # TMUX wrap start
  printf -- '\ePtmux;'
  # TMUX escape `ESC`
  printf -- '\e'
fi

# OSC52 start
printf -- '\e]52;c;'
# OSC52 body
base64 --wrap 0 -- "$@"

if ((T)); then
  # TMUX escape `ESC`
  printf -- '\e'
fi

# OSC52 end
# shellcheck disable=SC1003
printf -- '\e\\'

if ((T)); then
  # TMUX wrap end
  # shellcheck disable=SC1003
  printf -- '\e\\'
fi
