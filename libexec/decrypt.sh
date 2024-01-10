#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

NAME="${0##*/}"
GPG=(./facts/*.gpg ./inventory.json.gpg)
ENV=(./facts/*.env ./inventory.json)

case "$NAME" in
decrypt.sh)
  rm -v -fr -- "${ENV[@]}"
  gpg --batch --default-recipient-self --decrypt-files -- "${GPG[@]}"
  ;;
encrypt.sh)
  rm -v -fr -- "${GPG[@]}"
  gpg --batch --default-recipient-self --encrypt-files -- "${ENV[@]}"
  ;;
*)
  exit 2
  ;;
esac
