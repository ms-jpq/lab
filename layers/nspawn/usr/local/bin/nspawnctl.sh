#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

HR='/usr/local/libexec/hr-run.sh'

ARGV=("$@")
ACTION="${1:-""}"
shift -- 1 || true

# shellcheck disable=SC1090
source -- "${0%/*}/../libexec/${0##*/}"
# shellcheck disable=SC2154
SERVICE_PIN=".#$SERVICE_NAME@.service"
CACHE="/var/cache/local/$LIB/services"
LIB="/var/lib/local/$LIB"

MACHINES=()
SERVICES=()
for MACH in "$@"; do
  MACHINES+=("$MACH")
  SERVICES+=("$SERVICE_NAME@$(systemd-escape -- "$MACH").service")
done

sctl() {
  "$HR" systemctl --no-pager --full --show-transaction "$@"
}

case "$ACTION" in
'')
  # shellcheck disable=SC2154
  mkdir -v -p -- "$LIB" >&2
  TREE=("$HR" tree --dirsfirst -F -a)
  case "$0" in
  */nspawnctl.sh)
    "${TREE[@]}" -L 2 -- "$LIB"
    "$HR" machinectl list --full --no-pager
    ;;
  *)
    "${TREE[@]}" -L 3 -- "$LIB"
    sctl status --lines 0 -- '2-qemu-microvm@*.service'
    ;;
  esac
  ;;
pin)
  for MACH in "${MACHINES[@]}"; do
    "$HR" chmod -v +t -- "$LIB/$MACH"
  done
  ;;
unpin)
  for MACH in "${MACHINES[@]}"; do
    "$HR" chmod -v -t -- "$LIB/$MACH"
  done
  ;;
start)
  sctl start -- "${SERVICES[@]}"
  ;;
restart)
  sctl restart -- "${SERVICES[@]}"
  ;;
stop)
  sctl stop -- "${SERVICES[@]}"
  ;;
kill)
  sctl kill -- "${SERVICES[@]}"
  sctl reset-failed -- "${SERVICES[@]}"
  ;;
enable)
  for MACH in "${MACHINES[@]}"; do
    "$HR" mkdir -v -p -- "$CACHE/$MACH"
    "$HR" touch -- "$LIB/$MACH/$SERVICE_PIN" "$CACHE/$MACH/$SERVICE_PIN"
  done
  ;;
disable)
  for MACH in "${MACHINES[@]}"; do
    "$HR" rm -v -fr -- "$LIB/$MACH/$SERVICE_PIN" "$CACHE/$MACH"
  done
  ;;
remove)
  for MACH in "${MACHINES[@]}"; do
    ROOT="$LIB/$MACH"
    set -x
    if [[ -k "$ROOT" ]] || [[ -f "$ROOT/.#fs.lck" ]]; then
      exit 1
    fi
    set +x
    # shellcheck disable=SC2154
    "$DEALLOC" "$ROOT"
  done
  ;;
*)
  printf -- '%s' '>? '
  printf -- '%q ' "$0" "${ARGV[@]}"
  printf -- '\n'
  exit 2
  ;;
esac
