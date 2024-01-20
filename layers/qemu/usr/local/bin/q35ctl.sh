#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LIB='/var/lib/local/qemu'
HR='/usr/local/libexec/hr-run.sh'

ARGV=("$@")
ACTION="${1:-""}"
shift -- 1 || true

SYSTEMD='/usr/local/lib/systemd/system'
WANTS="$SYSTEMD/multi-user.target.wants"

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
  mkdir -v -p -- "$WANTS"
  for SVC in "${SERVICES[@]}"; do
    "$HR" ln -v -sf -- '../2-qemu-q35@.service' "$WANTS/$SVC"
  done
  for SOCK in "${SOCKS[@]}"; do
    "$HR" ln -v -sf -- '../2-websock-proxy@.socket' "$WANTS/$SOCK"
  done
  if ((${#SOCKS[@]})); then
    sctl start -- "${SOCKS[@]}"
  fi
  ;;
disable)
  RM=()
  for SVC in "${SERVICES[@]}"; do
    RM+=("$WANTS/$SVC")
  done
  for SOCK in "${SOCKS[@]}"; do
    RM+=("$WANTS/$SOCK")
  done
  "$HR" rm -v -fr -- "${RM[@]}"
  sctl stop -- "${SOCKS[@]}"
  ;;
*)
  printf -- '%s' '>? '
  printf -- '%q ' "$0" "${ARGV[@]}"
  printf -- '\n'
  exit 2
  ;;
esac
