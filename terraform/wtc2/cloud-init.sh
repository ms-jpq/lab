#!/usr/bin/env -S -- bash

set -Eeu
set -o pipefail
shopt -s dotglob nullglob extglob globstar

SSH="/$USER/.ssh"
# shellcheck disable=SC2174
mkdir --parents --mode 0700 -- "$SSH"
# shellcheck disable=SC2154
printf -- '%s' "$SSH_KEYS" >>"$SSH/authorized_keys"
