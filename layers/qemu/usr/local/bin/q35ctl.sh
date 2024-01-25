#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

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
  MACH="$(systemd-escape -- "$NAME")"
  SERVICES+=("2-qemu-q35@$MACH.service")
  SOCKS+=("2-websock-proxy@$MACH.socket")
done

sctl() {
  "$HR" systemctl --no-pager --full --show-transaction "$@"
}

case "$ACTION" in
'')
  mkdir -v -p -- "$LIB" >&2
  "$HR" tree --dirsfirst -F -a -L 3 -- "$LIB"
  sctl status --lines 0 -- '2-qemu-q35@*.service'
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
  for MACH in "$@"; do
    ROOT="$LIB/$MACH"
    "$HR" touch -- "$ROOT/$SERVICE_PIN" "$ROOT/$SOCK_PIN"
  done
  if ((${#SOCKS[@]})); then
    sctl start -- "${SOCKS[@]}"
  fi
  ;;
disable)
  for MACH in "$@"; do
    ROOT="$LIB/$MACH"
    "$HR" rm -v -fr -- "$ROOT/$SERVICE_PIN" "$ROOT/$SOCK_PIN"
  done
  ;;
remove)
  for MACH in "$@"; do
    ROOT="$LIB/$MACH"
    set -x
    if [[ -k "$ROOT" ]] || [[ -f "$ROOT/.#fs.lck" ]]; then
      exit 1
    fi
    "$0" disable "$MACH"
    set +x
    /usr/local/opt/qemu/libexec/fs-dealloc.sh "$ROOT"
  done
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
