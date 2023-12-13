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

for MACHINE in "${MACHINES[@]}"; do
  EXEC=(
    ./libexec/inventory.sh
    --inventory './inventory.json'
    --machine "$MACHINE"
    --action
  )
  printf -v ARGV -- '%q ' "$@"
  "${EXEC[@]}" exec -- "$ARGV"
done
