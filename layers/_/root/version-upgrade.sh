#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

export -- DEBIAN_FRONTEND=noninteractive

if [[ ${RECUR:-} == 1 ]]; then
  apt-get update
  apt-get full-upgrade --assume-yes
  exec -- do-release-upgrade --frontend=DistUpgradeViewNonInteractive
fi

SELF="$(realpath -- "$0")"
SESSION='version-upgrade'

if tmux has-session --target "$SESSION" 2> /dev/null; then
  exec -- tmux attach-session --target "$SESSION"
fi

printf -v COMMAND -- 'exec -- env -- RECUR=1 %q' "$SELF"
tmux new-session --detach --session "$SESSION" "$COMMAND"
exec -- tmux attach-session --target "$SESSION"
