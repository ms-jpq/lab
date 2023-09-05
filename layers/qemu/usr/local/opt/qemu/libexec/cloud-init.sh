#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

HOSTNAME="$1"
DST="$2"

export -- HOSTNAME PASSWD AUTHORIZED_KEYS

TMP="$(mktemp -d)"
envsubst <./cloud-init/meta-data.yml >"$TMP/meta-data"

SALT="$(uuidgen)"
PASSWD="$(openssl passwd -1 -salt "$SALT" root)"

RS='/root/.ssh'
KEYS="$(cat -- "$RS/authorized_keys" "$RS"/*.pub | sed -E '/^\s*$/d')"
readarray -t -- SSH_KEYS <<<"$KEYS"
printf -v AUTHORIZED_KEYS -- '\n      - %s' "${SSH_KEYS[@]}"

envsubst <./cloud-init/user-data.yml >"$TMP/user-data"

cp -a -R -f -- ./cloud-init/scripts "$TMP/scripts"
rm -v -fr -- "$DST"
exec -- genisoimage -volid cidata -joliet -rock -output "$DST" -- "$TMP"/*
