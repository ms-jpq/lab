#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

OPTS='m:,e'
LONG_OPTS='machine:,exec'
GO="$(getopt --options="$OPTS" --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

USER=root
MACHINES=()
EX=0
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
  -e | --exec)
    EX=1
    shift -- 1
    ;;
  *)
    exit 1
    ;;
  esac
done

SH="./var/sh"
INVENTORY='./inventory.json'

for MACHINE in "${MACHINES[@]}"; do
  if ! [[ -d "machines/$MACHINE" ]]; then
    exit 1
  fi
done

if ! [[ -v UNDER ]]; then
  if ! ((EX)); then
    gmake MACHINE="${MACHINES[*]}" local
  fi
  if ((EX)); then
    ARGV+=(--exec)
  else
    ARGV=()
  fi
  printf -- '%s\0' "${MACHINES[@]}" | UNDER=1 xargs -0 -I % -n 1 -P 0 -- "$0" --machine % "${ARGV[@]}" -- "$@"
  exit
else
  MACHINE="${MACHINES[*]}"
  EXEC=(
    ./libexec/inventory.sh
    --inventory "$INVENTORY"
    --machine "$MACHINE"
    --action
  )

  if ((EX)); then
    printf -v ESC -- '%q ' "$@"
  else
    SRC="./var/tmp/machines/$MACHINE/fs"
    "${EXEC[@]}" exec -- "$(<"$SH/libexec/essentials.sh")"
    "${EXEC[@]}" sync -- "$SRC/"
    printf -v ESC -- '%q ' gmake --directory /usr/local/opt/initd "$@"
  fi
  "${EXEC[@]}" exec -- "$ESC"
fi
