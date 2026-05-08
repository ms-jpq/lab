#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

TARGET="$1"
PORT="$2"
IDENTITY="$3"
shift -- 3

# shellcheck disable=SC2154
SSH=(
  ssh
  -N
  -T
  -F /dev/null
  -o BatchMode=yes
  -o ClearAllForwardings=yes
  -o ConnectTimeout=10
  -o ControlMaster=auto
  -o ControlPath="$RUNTIME_DIRECTORY/%C"
  -o ControlPersist=60
  -o ExitOnForwardFailure=yes
  -o GlobalKnownHostsFile=/dev/null
  -o IdentitiesOnly=yes
  -o LogLevel=INFO
  -o ServerAliveCountMax=6
  -o ServerAliveInterval=1
  -o StrictHostKeyChecking=accept-new
  -o UserKnownHostsFile="$STATE_DIRECTORY/known_hosts.txt"
  -p "$PORT"
  -i "$IDENTITY"
  "$@"
  --
  "$TARGET"
)

exec -- "${SSH[@]}"
