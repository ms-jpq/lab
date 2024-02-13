#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

BASE="${0%/*}/.."
BUCKET='s3://chumbucket-lab'
S5="$BASE/var/bin/s5cmd"
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
    facts/*.env
    inventory.json
    terraform/bootstrap/terraform.tfstate
    terraform/bootstrap/terraform.tfstate.backup
  )

  dir
  for F in "${FILES[@]}"; do
    if [[ -f "$F" ]]; then
      NAME="$TMP/$F"
      mkdir -v -p -- "${NAME%/*}"
      cp -v -R -- "$F" "$NAME"
    fi
  done

  find "$TMP" -type f -print0 | xargs -r -0 -- gpg --batch --yes --encrypt-files --
  find "$TMP" -type f -not -name '*.gpg' -delete
  "$S5" sync --delete -- "$TMP/" "$BUCKET"
  ;;
pull)
  dir
  "$S5" cp -- "$BUCKET/*" "$TMP"
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
  if [[ "$DIE" == 'yes' ]]; then
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
