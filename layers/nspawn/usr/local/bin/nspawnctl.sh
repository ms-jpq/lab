#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LIB='/var/local/lib/machines'
HR='/usr/local/libexec/hr-run.sh'

ACTION="${1:-"ls"}"
shift -- 1 || true

MACHINES=()
SERVICES=()
for NAME in "$@"; do
  MACH="$(systemd-escape -- "$NAME")"
  MACHINES+=("$MACH")
  SERVICES+=("1-nspawnd@$MACH.service")
done

sctl() {
  "$HR" systemctl --no-pager --plain --full --show-transaction "$@"
}

case "$ACTION" in
ls)
  "$HR" ls --almost-all --group-directories-first --classify -l --no-group --si --color=auto -- "$LIB"
  "$HR" machinectl list --all --no-pager
  ;;
pin)
  for MACH in "${MACHINES[@]}"; do
    "$HR" chmod +t -- "$LIB/$MACH"
  done
  ;;
unpin)
  for MACH in "${MACHINES[@]}"; do
    "$HR" chmod -t -- "$LIB/$MACH"
  done
  ;;
start)
  sctl start -- "${SERVICES[@]}"
  ;;
stop)
  sctl stop -- "${SERVICES[@]}"
  ;;
enable)
  everyone
  ;;
disable)
  everyone
  ;;
remove)
  for MACH in "${MACHINES[@]}"; do
    ROOT="$LIB/$MACH"
    if ! [[ -k "$ROOT" ]]; then
      "$HR" rm -v -fr -- "$ROOT"
    fi
  done
  ;;
*)
  exit 2
  ;;
esac
