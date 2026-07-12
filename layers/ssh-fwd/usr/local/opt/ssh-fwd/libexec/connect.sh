#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

TARGET="$1"
PORT="$2"
IDENTITY="$3"
shift -- 3

# shellcheck disable=SC2154
SSH=(
  ssh
  -F /dev/null
  -o BatchMode=yes
  -o ConnectTimeout=9
  -o ExitOnForwardFailure=yes
  -o ForwardAgent=no
  -o ForwardX11=no
  -o GlobalKnownHostsFile=/dev/null
  -o GSSAPIAuthentication=no
  -o HostbasedAuthentication=no
  -o IdentitiesOnly=yes
  -o KbdInteractiveAuthentication=no
  -o PasswordAuthentication=no
  -o PermitLocalCommand=no
  -o RequestTTY=no
  -o ServerAliveCountMax=6
  -o ServerAliveInterval=1
  -o StrictHostKeyChecking=accept-new
  -o Tunnel=no
  -o UserKnownHostsFile=/dev/null
  -p "$PORT"
  -i "$IDENTITY"
  "$@"
  --
  "$TARGET"
)

exec -- "${SSH[@]}"
