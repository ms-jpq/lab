#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CACHE='/var/cache/local/qemu/services'
LIB='/var/lib/local/qemu'
HR='/usr/local/libexec/hr-run.sh'

ARGV=("$@")
ACTION="${1:-""}"
shift -- 1 || true

SERVICE_PIN='.#2-qemu-q35@.service'
SOCK_PIN='.#2-websock-proxy@.socket'

SERVICES=()
SOCKS=()
for NAME in "$@"; do
  NAME="${NAME,,}"
  NAME="${NAME:0:12}"
  NAME="${NAME//[^A-z0-9]/'-'}"

  MACH="$(systemd-escape -- "$NAME")"
  SERVICES+=("2-qemu-q35@$MACH.service")
  SOCKS+=("2-websock-proxy@$MACH.socket")
done

sctl() {
  "$HR" systemctl --no-pager --full --show-types --show-transaction "$@"
}

case "$ACTION" in
'')
  mkdir -v -p -- "$LIB" >&2
  "$HR" tree --dirsfirst -F -a -L 3 -- "$LIB"
  sctl status --lines 0 -- '2-qemu-q35@*.service'
  ;;
start | restart | stop | reload | kill)
  sctl "$ACTION" -- "${SERVICES[@]}"
  ;;
enable | lazy)
  for MACH in "$@"; do
    ROOT="$LIB/$MACH"
    CM="$CACHE/$MACH"
    "$HR" mkdir -v -p -- "$CM"
    PINS=("$ROOT/$SOCK_PIN" "$CM/$SOCK_PIN")
    if [[ $ACTION == 'enable' ]]; then
      PINS+=("$ROOT/$SERVICE_PIN" "$CM/$SERVICE_PIN")
    fi
    "$HR" touch -- "${PINS[@]}"
  done
  if ((${#SOCKS[@]})); then
    sctl start -- "${SOCKS[@]}"
  fi
  ;;
disable)
  for MACH in "$@"; do
    ROOT="$LIB/$MACH"
    "$HR" rm -v -fr -- "$ROOT/$SERVICE_PIN" "$ROOT/$SOCK_PIN" "$CACHE/$MACH"
  done
  ;;
remove)
  for MACH in "$@"; do
    ROOT="$LIB/$MACH"
    set -x
    if [[ -k $ROOT ]] || [[ -f "$ROOT/.#fs.lck" ]]; then
      exit 1
    fi
    "$0" disable "$MACH"
    set +x
    /usr/local/libexec/fs-dealloc.sh "$ROOT" /var/lib/local /var/lib/local/qemu
  done
  if ((${#SOCKS[@]})); then
    sctl stop -- "${SOCKS[@]}"
  fi
  ;;
pin | unpin)
  microvmctl.sh "${ARGV[@]}"
  ;;
*)
  printf -- '%s' '>? '
  printf -- '%q ' "$0" "${ARGV[@]}"
  printf -- '\n'
  exit 2
  ;;
esac
