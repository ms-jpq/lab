#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

InitiatorName=
# shellcheck disable=SC1091
source -- '/etc/iscsi/initiatorname.iscsi'
PREFIX="${InitiatorName%%:*}"

/usr/local/libexec/m4.sh -D"ENV_INITIATOR_NAME=$InitiatorName" "${0%/*}/../share.m4" | targetcli
