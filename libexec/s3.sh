#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

BUCKET='s3://chumbucket-lab'
S5="$PWD/var/bin/s5cmd"
TMP="$PWD/var/gpg"

dir() (
  rm -v -fr -- "$TMP"
  mkdir -v -p -- "$TMP"
  chmod -v g-rwx,o-rwx "$TMP"
)

case "${1:-""}" in
'')
  "$S5" ls --humanize -- "$BUCKET" | awk '{ gsub("%2F", "/", $NF); print }' | column -t
  ;;
push)
  FILES=(
    facts/*.env
    inventory.json
    terraform/bootstrap/terraform.tfstate
    terraform/bootstrap/terraform.tfstate.backup
  )

  SECRETS=()
  for F in "${FILES[@]}"; do
    if [[ -f "$F" ]]; then
      SECRETS+=("$F")
    fi
  done

  dir
  gpg -v --batch --yes --encrypt-files -- "${SECRETS[@]}"
  for F in "${SECRETS[@]}"; do
    F="$F.gpg"
    NAME="$(jq --raw-input --raw-output '@uri' <<<"$F")"
    mv -v -f -- "$F" "$TMP/$NAME"
  done
  "$S5" sync --delete -- "$TMP/" "$BUCKET"
  ;;
pull)
  dir
  "$S5" cp -- "$BUCKET/*" "$TMP"
  FILES=("$TMP"/*.gpg)
  gpg -v --batch --decrypt-files -- "${FILES[@]}"
  for F in "${FILES[@]}"; do
    F="${F%.gpg}"
    F2="${F#"$TMP/"}"
    NAME="${F2//'%2F'/'/'}"
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
