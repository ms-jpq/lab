#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

BASE="${0%/*}/.."
BUCKET='s3://kfc-lab'
S5="$(realpath -- "$BASE/var/bin/s5cmd")"
TMP="$BASE/var/gpg"

dir() (
  rm -fr -- "$TMP"
  mkdir -v -p -- "$TMP"
  chmod -v g-rwx,o-rwx "$TMP"
)

case "${1:-""}" in
'' | s3)
  "$S5" ls --humanize -- "$BUCKET/**"
  ;;
push)
  FILES=(
    facts/*.{env,env.*}
    inventory.json
    terraform/bootstrap/terraform.tfstate
    terraform/bootstrap/terraform.tfstate.backup
  )

  dir
  for F in "${FILES[@]}"; do
    if [[ -f $F ]]; then
      NAME="$TMP/$F"
      mkdir -v -p -- "${NAME%/*}"
      cp -v -R -- "$F" "$NAME"
    fi
  done

  find "$TMP" -type f -exec gpg --batch --yes --encrypt-files -- '{}' +
  find "$TMP" -type f -not -name '*.gpg' -delete
  pushd -- "$TMP"
  "$S5" sync --delete -- ./ "$BUCKET" | cut -d ' ' -f -2
  ;;
pull)
  dir
  pushd -- "$TMP"
  "$S5" cp -- "$BUCKET/*" . | cut -d ' ' -f -2
  popd
  FILES=("$TMP"/**/*.gpg)
  gpg -v --batch --decrypt-files -- "${FILES[@]}"
  for F in "${FILES[@]}"; do
    F="${F%.gpg}"
    NAME="${F#"$TMP/"}"
    mv -v -f -- "$F" "$NAME"
  done
  ;;
rmfr)
  read -r -p '>>> (yes/no)?' -- DIE
  if [[ $DIE == 'yes' ]]; then
    "$S5" rm --all-versions -- "$BUCKET/*"
  else
    exit 130
  fi
  ;;
*)
  set -x
  exit 2
  ;;
esac
