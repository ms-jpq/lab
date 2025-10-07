#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

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
  DEFS="facts/$MACHINE.env"
  SRC="machines/$MACHINE"
  DST="var/tmp/machines/$MACHINE"

  mkdir -p -- "$DST"
  find "$DST" -mindepth 1 -delete

  for F in "$SRC"/**/*; do
    REL="$DST/${F#"$SRC"/}"
    if [[ -d $F ]]; then
      mkdir -p -- "$REL"
    elif [[ $F == *.m4* ]]; then
      ./libexec/m4.sh "$F" "${REL//'.m4'/''}" "$DEFS"
    else
      cp -a -- "$F" "$REL"
    fi
  done

  tar --create --directory "$DST" -- . | "${RSH[@]}" "$MACHINE" "${TAR[@]}" "$SINK"
done
