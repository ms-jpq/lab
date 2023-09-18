#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LIB='/var/lib/local/qemu'
HR='/usr/local/libexec/hr-run.sh'

ARGV=("$@")
ACTION="${1:-"ls"}"
shift -- 1 || true

SYSTEMD='/usr/local/lib/systemd/system'
MWANTS="$SYSTEMD/default.target.wants"
SWANTS="$SYSTEMD/sockets.target.wants"

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
ls)
  mkdir -v -p -- "$LIB" >&2
  "$HR" tree --dirsfirst -F -a -L 2 -- "$LIB"
  sctl status -- '2-qemu-q35@*.service' '2-swtpm@*.service' '2-websock-display@*.service' '2-websock-proxy@*.*'
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
enable)
  mkdir -v -p -- "$MWANTS" "$SWANTS"
  for SVC in "${SERVICES[@]}"; do
    "$HR" ln -v -sf -- '../2-qemu-q35@.service' "$MWANTS/$SVC"
  done
  for SOCK in "${SOCKS[@]}"; do
    "$HR" ln -v -sf -- '../2-websock-proxy@.socket' "$SWANTS/$SOCK"
  done
  ;;
disable)
  RM=()
  for SVC in "${SERVICES[@]}"; do
    RM+=("$MWANTS/$SVC")
  done
  for SOCK in "${SOCKS[@]}"; do
    RM+=("$SWANTS/$SOCK")
  done
  "$HR" rm -v -fr -- "${RM[@]}"
  ;;
*)
  printf -- '%s' '>? '
  printf -- '%q ' "$0" "${ARGV[@]}"
  printf -- '\n'
  exit 2
  ;;
esac
