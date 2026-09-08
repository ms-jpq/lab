#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

export -- DEBIAN_FRONTEND=noninteractive

if ((EUID != 0)); then
  printf -- '%s\n' 'Run this script as root.' >&2
  exit 1
fi

if [[ ${RECUR:-} == 1 ]]; then
  apt-get update --error-on=any
  apt-get full-upgrade --assume-yes -o APT::Get::Always-Include-Phased-Updates=true -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold

  if [[ -e /run/reboot-required ]]; then
    printf -- '%s\n' 'Preparatory updates require a reboot. Reboot, then rerun this script.' >&2
    exit 1
  fi
  exec -- do-release-upgrade --frontend=DistUpgradeViewNonInteractive
fi

SELF="$(realpath -- "$0")"
SESSION='version-upgrade'
TM=(tmux -L "$SESSION" -f /dev/null)

if "${TM[@]}" has-session -t "=$SESSION" 2> /dev/null; then
  exec -- env -u TMUX "${TM[@]}" attach-session -t "=$SESSION"
fi

printf -- '%s\n' 'Before proceeding, ensure backups and a tested recovery console exist. tmux does not protect against loss of SSH access.' >&2
printf -v COMMAND -- 'exec -- env -- RECUR=1 %q' "$SELF"
"${TM[@]}" new-session -d -s "$SESSION" /bin/sh \; set-option -w -t "=$SESSION:" remain-on-exit on \; respawn-pane -k -t "=$SESSION:" "$COMMAND"
exec -- env -u TMUX "${TM[@]}" attach-session -t "=$SESSION"
