#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN='/run/local/qemu'

ACTION="$1"
MACHINE="$2"
shift -- 2

case "$ACTION" in
c | con | console)
  SOCK='con'
  ;;
m | mon | monitor)
  SOCK='mon'
  ;;
q | qmp)
  SOCK='qmp'
  ;;
*)
  set -x
  exit 2
  ;;
esac

SOCKET="$RUN/$MACHINE/$SOCK.sock"
exec -- rlwrap -- nc -U -- "$SOCKET"
