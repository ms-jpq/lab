#!/usr/bin/env -S -- bash

set -Eeu
set -o pipefail
shopt -s dotglob nullglob extglob globstar

SSH="/root/.ssh"
# shellcheck disable=SC2174
mkdir -v --parents --mode 0700 -- "$SSH"
# shellcheck disable=SC2154
printf -- '\n%s\n' "$SSH_KEYS" >>"$SSH/authorized_keys"

hostnamectl hostname -- "$HOSTNAME"

PACKAGES=(zfsutils-linux)
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends --yes -- "${PACKAGES[@]}"
