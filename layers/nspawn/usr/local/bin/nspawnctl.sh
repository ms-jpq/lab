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
  MACH="${MACH,,}"
  MACH="${MACH:0:12}"
  MACH="${MACH//[^A-z0-9]/'-'}"
  MACHINES+=("$MACH")
  SERVICES+=("$SERVICE_NAME@$(systemd-escape -- "$MACH").service")
done

sctl() {
  "$HR" systemctl --no-pager --full --show-types --show-transaction "$@"
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
start | restart | stop | kill)
  sctl "$ACTION" -- "${SERVICES[@]}"
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
  "$0" disable "${MACHINES[@]}"
  for MACH in "${MACHINES[@]}"; do
    ROOT="$LIB/$MACH"
    set -x
    if [[ -k $ROOT ]] || [[ -f "$ROOT/.#fs.lck" ]]; then
      exit 1
    fi
    set +x

    ETC_ID="$ROOT/fs/etc/machine-id"
    if [[ -f $ETC_ID ]]; then
      MACH_ID="$(< "$ETC_ID")"
      if [[ -n $MACH_ID ]]; then
        rm -v -fr -- "/var/log/journal/$MACH_ID"
      fi
    fi

    SVC="$SERVICE_NAME@$(systemd-escape -- "$MACH").service"
    /usr/local/libexec/fs-dealloc.sh "$ROOT" /var/lib/local /var/lib/local/{nspawn,qemu}
    if systemctl --failed --lines 0 status -- "$SVC" > /dev/null; then
      sctl reset-failed -- "$SVC"
    fi
  done
  ;;
*)
  printf -- '%s' '>? '
  printf -- '%q ' "$0" "${ARGV[@]}"
  printf -- '\n'
  exit 2
  ;;
esac
