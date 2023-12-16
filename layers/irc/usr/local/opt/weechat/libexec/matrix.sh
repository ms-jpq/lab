#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LO=/var/cache/local
CACHE="$LO/weechat"
PYTHON=/var/lib/local/weechat/data/python
MATRIX="$CACHE/python/matrix"
VENV="$CACHE/venv"
PROJECT=weechat-matrix
GIT="$CACHE/$PROJECT"
URI="https://github.com/poljar/$PROJECT"

if ! [[ -v INVOCATION_ID ]]; then
  RUN=(
    systemd-run
    --collect
    --pipe
    --service-type oneshot
    --property ProtectSystem=strict
    --property ProtectHome=yes
    --property PrivateTmp=yes
    --property ReadWritePaths="/tmp /var/tmp $CACHE $PYTHON"
    -- "$(realpath -- "$0")"
  )
  exec -- "${RUN[@]}"
fi

if ! [[ -d "$VENV" ]]; then
  python3 -m venv -- "$VENV"
fi

if ! [[ -L "$MATRIX" ]]; then
  PM="$PYTHON/matrix"
  mkdir -v -p -- "$PM"
  ln -v -s -- "$PM" "$MATRIX"
fi

if [[ -d "$GIT" ]]; then
  pushd -- "$GIT"
  git pull
else
  NPROC="$(nproc)"
  git clone --jobs="$NPROC" -- "$URI" "$GIT"
  pushd -- "$GIT"
fi

PATH="$VENV/bin:$PATH"
exec -- make --debug -- install XDG_DATA_HOME="$LO"
