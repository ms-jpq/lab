#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

BUCKET='chum-lab'
TMP="$PWD/var/gpg"

dir() (
  rm -v -fr -- "$TMP"
  mkdir -v -p -- "$TMP"
)

case "${1:-""}" in
'')
  aws s3api list-objects-v2 --bucket "$BUCKET" | jq --raw-output '.Contents[].Key' | awk '{ gsub("%2F", "/"); print }'
  ;;
push)
  FILES=(
    facts/*.env
    inventory.json
    tf/bootstrap/terraform.tfstate
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
  aws s3 sync -- "$TMP/" "s3://$BUCKET"
  ;;
pull)
  dir
  aws s3 cp --recursive -- "s3://$BUCKET" "$TMP"
  FILES=("$TMP"/*.gpg)
  gpg -v --batch --decrypt-files -- "${FILES[@]}"
  for F in "${FILES[@]}"; do
    F2="${F%.gpg}"
    F2="${F2#"$TMP/"}"
    NAME="${F2//'%2F'/'/'}"
    mv -v -f -- "$F" "$NAME"
  done
  ;;
*)
  set -x
  exit 2
  ;;
esac