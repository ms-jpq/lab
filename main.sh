#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

OPTS='m:'
LONG_OPTS='machine:'
GO="$(getopt --options="$OPTS" --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

USER=root
MACHINES=()
while (($#)); do
  case "$1" in
  --)
    shift -- 1
    break
    ;;
  -m | --machine)
    MACHINES+=("$2")
    shift -- 2
    ;;
  *)
    exit 1
    ;;
  esac
done

SH="./var/sh"
INVENTORY='./inventory.json'

set -x
if ! [[ -f "$INVENTORY" ]]; then
  exit 1
fi
set +x

gmake MACHINE="${MACHINES[*]}" local

for MACHINE in "${MACHINES[@]}"; do
  SRC="./var/tmp/machines/$MACHINE/fs"

  EXEC=(
    ./libexec/inventory.sh
    --inventory "$INVENTORY"
    --machine "$MACHINE"
    --action
  )

  "${EXEC[@]}" exec -- "$(<"$SH/libexec/essentials.sh")"
  "${EXEC[@]}" sync -- "$SRC/"
  printf -v ESC -- '%q ' gmake --directory /usr/local/opt/initd "$@"
  "${EXEC[@]}" exec -- "$ESC"
done
