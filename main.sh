#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

OPTS='m:,e,d'
LONG_OPTS='machine:,exec,diff'
GO="$(getopt --options="$OPTS" --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

MACHINES=()
DIFF=0
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
  -d | --diff)
    DIFF=1
    shift -- 1
    ;;
  *)
    exit 1
    ;;
  esac
done

SH="./var/sh"
INVENTORY='./inventory.json'

if [[ ${MACHINES[*]} != '*' ]]; then
  for MACHINE in "${MACHINES[@]}"; do
    if ! [[ -d "machines/$MACHINE" ]]; then
      set -x
      exit 1
    fi
  done
fi

if ! [[ -v UNDER ]]; then
  if ! ((EX)); then
    MAKE_ARGS=()
    if ((DIFF)); then
      MAKE_ARGS+=(DIFF=1)
    fi
    gmake MACHINE="${MACHINES[*]}" local "${MAKE_ARGS[@]}"
  fi

  if ((DIFF)); then
    ARGV+=(--diff)
  elif ((EX)); then
    ARGV+=(--exec)
  else
    ARGV=()
  fi
  printf -- '%s\0' "${MACHINES[@]}" | UNDER=1 xargs -r -0 -I % -P 0 -- "$0" --machine % "${ARGV[@]}" -- "$@"
  exit
else
  MACHINE="${MACHINES[*]}"
  if ((DIFF)); then
    set -x
    exec -- git diff --no-index --no-prefix -- "./var/tmp/machines/$MACHINE" "./var/diff/machines/$MACHINE"
  fi
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
    "${EXEC[@]}" exec <<< "$(< "$SH/libexec/essentials.sh")"
    "${EXEC[@]}" sync -- "$SRC/"
    printf -v ESC -- '%q ' gmake --directory /usr/local/opt/initd "$@"
  fi
  "${EXEC[@]}" exec -- -c "$ESC"
fi
