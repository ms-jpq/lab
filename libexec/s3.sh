#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

BASE="${0%/*}/.."
BUCKET='s3://kfc-lab'
TMP="$BASE/var/gpg"

S3HOST='s3.ca-west-1.amazonaws.com'
export -- AWS_SHARED_CREDENTIALS_FILE="$HOME/.config/aws/credentials"
S3=(
  "$(realpath -- "$BASE/.venv/bin/s3cmd")"
  --no-guess-mime-type
  --no-mime-magic
  --delete-after
  --host "$S3HOST"
  --host-bucket "%(bucket).$S3HOST"
)

dir() (
  rm -fr -- "$TMP"
  mkdir -v -p -- "$TMP"
  chmod -v g-rwx,o-rwx "$TMP"
)

case "${1:-""}" in
'' | s3 | ls)
  "${S3[@]}" ls --recursive --human-readable-sizes -- "$BUCKET"
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
  "${S3[@]}" sync --delete-after --delete-removed -- ./ "$BUCKET"
  ;;
pull)
  dir
  pushd -- "$TMP"
  "${S3[@]}" sync -- "$BUCKET/" ./
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
    "${S3[@]}" rm --recursive --force -- "$BUCKET/"
  else
    exit 130
  fi
  ;;
*)
  set -x
  exit 2
  ;;
esac
