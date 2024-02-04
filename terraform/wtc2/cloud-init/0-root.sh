#!/usr/bin/env -S -- bash

set -Eeu
set -o pipefail
shopt -s dotglob nullglob extglob globstar

SSH="/root/.ssh"
# shellcheck disable=SC2174
mkdir -v --parents --mode 0700 -- "$SSH"
{
  printf -- '\n'
  # shellcheck disable=SC2154
  base64 --decode <<<"$SSH_KEYS"
  printf -- '\n'
} >>"$SSH/authorized_keys"

HOST="$(base64 --decode <<<"$HOSTNAME")"
hostnamectl hostname -- "$HOST"

PACKAGES=(zfsutils-linux)
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends --yes -- "${PACKAGES[@]}"

snap remove -- lxd
