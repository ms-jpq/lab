#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"
LOCAL="$RUN/local-fs.target.wants"
REMOTE="$RUN/remote-fs.target.wants"

mkdir -v -p -- "$LOCAL" "$REMOTE"
for MOUNT in /usr/local/lib/systemd/system/*.mount; do
  NAME="${MOUNT##*/}"
  NAME="${NAME%.mount}"
  AUTO="$NAME.automount"
  cp -v -f -- /usr/local/opt/mount/@.automount "$RUN/$AUTO"
  chmod g+r,o+r -- "$RUN/$AUTO"

  if grep -E -e '^Type\s*=\s*nfs' -e '_netdev' -- "$MOUNT"; then
    WANTS="$REMOTE"
  else
    WANTS="$LOCAL"
  fi

  ln -v -sf -- "../$AUTO" "$WANTS/$AUTO"
done
