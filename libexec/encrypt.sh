#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

ENCRYPTED_SYMMETRIC="$1"
shift

SYMMETRIC="$(gpg --batch --decrypt -- "$ENCRYPTED_SYMMETRIC")"
EXT='.gpg'

GPG=(--batch --passphrase-fd 0 --output)

case "${0##*/}" in
encrypt.sh)
  for FILE in "$@"; do
    OUT="$FILE$EXT"
    rm -v -fr -- "$OUT"
    printf -- '%s' "$SYMMETRIC" | gpg --symmetric "${GPG[@]}" "$OUT" -- "$FILE"
  done
  ;;
decrypt.sh)
  for FILE in "$@"; do
    OUT="${FILE%%"$EXT"}"
    rm -v -fr -- "$OUT"
    printf -- '%s' "$SYMMETRIC" | gpg --decrypt "${GPG[@]}" "$OUT" -- "$FILE"
  done
  ;;
*)
  exit 2
  ;;
esac
