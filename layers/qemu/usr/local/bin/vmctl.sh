#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LIB='/var/lib/local/qemu'
HR='/usr/local/libexec/hr-run.sh'

ARGV=("$@")
ACTION="${1:-"ls"}"
shift -- 1 || true

WANTS='/usr/local/lib/systemd/system/machines.target.wants'
MACHINES=()
SERVICES=()
for NAME in "$@"; do
  MACH="$(systemd-escape -- "$NAME")"
  MACHINES+=("$MACH")
  SERVICES+=("2-nspawnd@$MACH.service")
done

sctl() {
  "$HR" systemctl --no-pager --plain --full --show-transaction "$@"
}

case "$ACTION" in
ls)
  mkdir -v -p -- "$LIB"
  "$HR" ls --almost-all --group-directories-first --classify -l --no-group --si --color=auto -- "$LIB"
  "$HR" machinectl list --full --no-pager
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
  mkdir -v -p -- "$WANTS"
  for SVC in "${SERVICES[@]}"; do
    "$HR" ln -v -sf -- '../2-nspawnd@.service' "$WANTS/$SVC"
  done
  ;;
disable)
  for SVC in "${SERVICES[@]}"; do
    "$HR" rm -v -fr -- "$WANTS/$SVC"
  done
  ;;
remove)
  for MACH in "${MACHINES[@]}"; do
    ROOT="$LIB/$MACH"
    set -x
    if ! [[ -k "$ROOT" ]] && ! [[ -k "$ROOT/fs" ]]; then
      "$HR" rm -v -fr -- "$ROOT"
    else
      exit 1
    fi
    set +x
  done
  ;;
*)
  printf -- '%s' '>? '
  printf -- '%q ' "$0" "${ARGV[@]}"
  printf -- '\n'
  exit 2
  ;;
esac
