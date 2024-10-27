#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

SRC="$1"
DST="./var/tmp/k8s/$SRC"
COMPOSE="var/tmp/machines/$SRC/fs/usr/local/k8s"

gmake MACHINE="$SRC" local
rm -fr -- "$DST"
mkdir -p -- "$DST"

DENV='./var/sh/zsh/dev/bin/denv.py'
KOMPOSE='./var/bin/kompose'

# Y2J=(yq --output-format json)
# J2Y=(yq --input-format json)

# read -r -d '' -- JQ <<- 'JQ' || true
# JQ

printf -- '%s\n' ">>> $COMPOSE" >&2
for FILE in "$COMPOSE"/*/docker-compose.yml; do
  DIR="${FILE%/*}"
  STACK="${DIR##*/}"
  ENV="$DIR/.env"

  printf -- '%s\n' "@ $STACK" >&2
  touch -- "$ENV"
  "$DENV" -- "$ENV" "$KOMPOSE" convert --stdout --namespace "$STACK" --file "$FILE" > "$DST/$STACK.yml"
done
printf -- '%s\n' "<<< $DST" >&2
