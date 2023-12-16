#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LO=/var/cache/local
CACHE="$LO/weechat"
PREFIX=/var/lib/local/weechat/data
VENV="$CACHE/venv"
PROJECT=weechat-matrix
GIT="$CACHE/$PROJECT"
URI="https://github.com/poljar/$PROJECT"

if ! [[ -v INVOCATION_ID ]]; then
  mkdir -v -p -- "$CACHE"
  RUN=(
    systemd-run
    --collect
    --pipe
    --service-type oneshot
    --property ProtectSystem=strict
    --property ProtectHome=yes
    --property PrivateTmp=yes
    --property ReadWritePaths="/tmp /var/tmp $CACHE $PREFIX/python"
    -- "$(realpath -- "$0")"
  )
  exec -- "${RUN[@]}"
fi

if [[ -d "$GIT" ]]; then
  pushd -- "$GIT"
  git pull
else
  NPROC="$(nproc)"
  git clone --jobs="$NPROC" -- "$URI" "$GIT"
  pushd -- "$GIT"
fi

if ! [[ -d "$VENV" ]]; then
  python3 -m venv -- "$VENV"
  "$VENV/bin/python3" -m pip install --require-virtualenv --cache-dir "$CACHE/pip" -r "$GIT/requirements.txt" -- future
fi

exec -- make --debug -- install PREFIX="$PREFIX"
