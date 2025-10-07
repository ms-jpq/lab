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
  --extract
  --preserve-permissions
  --keep-directory-symlink
  --directory
)
SINK='/c'
FD_INNER=('(' -type f -or -type l ')')

for MACHINE in "${MACHINES[@]}"; do
  SRC="machines/$MACHINE"
  DST="var/tmp/machines/$MACHINE"
  FS="$DST/fs"
  DEFS="$DST/.env"

  mkdir -p -- "$FS"
  find "$FS" -mindepth 1 -delete
  ./libexec/facts.sh "$MACHINE" "facts/$MACHINE".{json,env} > "$DEFS"

  RAND_HEX="$(find "$SRC" "${FD_INNER[@]}" -print0 | xargs -0 --no-run-if-empty -- cat -- "$DEFS" | b3sum --length 64 -- | cut -d ' ' -f 1)"
  for F in "$SRC"/**/*; do
    REL="$FS/${F#"$SRC"/}"
    if [[ -d $F ]]; then
      mkdir -p -- "$REL"
    elif [[ $F == *.m4* ]]; then
      ./libexec/m4.sh "$F" "${REL//'.m4'/''}" "$DEFS" -D"ENV_RAND_HEX=$RAND_HEX"
    else
      cp -a -- "$F" "$REL"
    fi
  done

  tar --create --directory "$FS" -- . | "${RSH[@]}" "$MACHINE" "${TAR[@]}" "$SINK"
done
