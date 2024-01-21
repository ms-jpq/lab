#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

HR='/usr/local/libexec/hr-run.sh'

ARGV=("$@")
ACTION="${1:-""}"
shift -- 1 || true

# shellcheck disable=SC1090
source -- "${0%/*}/../libexec/${0##*/}"
# shellcheck disable=SC2154
WANTS="/usr/local/lib/systemd/system/$TARGET.target.wants"
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
  mkdir -v -p -- "$WANTS"
  for SVC in "${SERVICES[@]}"; do
    "$HR" ln -v -sf -- "../$SERVICE_NAME@.service" "$WANTS/$SVC"
  done
  ;;
disable)
  RM=()
  for SVC in "${SERVICES[@]}"; do
    RM+=("$WANTS/$SVC")
  done
  "$HR" rm -v -fr -- "${RM[@]}"
  ;;
remove)
  for MACH in "${MACHINES[@]}"; do
    ROOT="$LIB/$MACH"
    SVC="$WANTS/$SERVICE_NAME@$(systemd-escape -- "$MACH").service"
    set -x
    if [[ -k "$ROOT" ]] || [[ -f "$ROOT/.#fs.lck" ]]; then
      exit 1
    fi
    set +x
    rm -v -fr -- "$SVC"
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
