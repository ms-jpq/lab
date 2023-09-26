#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/default.target.wants"

mkdir -v -p -- "$WANTS"
for KEY in /var/lib/local/zfs/*.key; do
  NAME="${KEY##*/}"
  NAME="${NAME%.key}"
  ln -v -sf -- /usr/local/lib/systemd/system/1-zsh-import-crypt@.service "$WANTS/1-zsh-import-crypt@$NAME.service"
done
