#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

HOSTNAME="$1"
DST="$2"

TMP="$(mktemp -d)"
envsubst <./cloud-init/meta-data.yml >"$TMP/meta-data"

SALT="$(uuidgen)"
PASSWD="$(openssl passwd -1 -salt "$SALT" root | jq --raw-input)"

RS=~/.ssh
USERDATA="$TMP/user-data"

export -- HOSTNAME PASSWD AUTHORIZED_KEYS
AUTHORIZED_KEYS="$(cat -- "$RS/authorized_keys" "$RS"/*.pub | jq --raw-input --slurp --compact-output 'split("\n") | map(select(. != ""))')"
envsubst <./cloud-init/user-data.yml >"$USERDATA"

# cat -- "$USERDATA"
# cloud-init schema --config-file "$USERDATA"

cp -v -a -R -f -- ./cloud-init/scripts "$TMP/scripts"
rm -v -fr -- "$DST"
exec -- genisoimage -volid cidata -joliet -rock -output "$DST" -- "$TMP"/*
