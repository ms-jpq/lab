#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

OPTS='m:,e'
LONG_OPTS='machine:,exec'
GO="$(getopt --options="$OPTS" --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

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

RSH=(
  ssh
  --
)
TAR=(
  '"%PROGRAMFILES%\Git\usr\bin\tar"'
  -v
  --extract
  --preserve-permissions
  --keep-directory-symlink
  --directory
)
SINK='/c'

for MACHINE in "${MACHINES[@]}"; do
  SRC="machines/$MACHINE"
  tar --create --directory "$SRC" -- . | "${RSH[@]}" "$MACHINE" "${TAR[@]}" "$SINK"
done
