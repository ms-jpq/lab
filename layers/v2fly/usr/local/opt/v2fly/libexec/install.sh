#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

TMP='/var/tmp/local/v2fly'
DST='/var/lib/local/v2fly/'

case "$HOSTTYPE" in
x86_64)
  ARCH=64
  ;;
aarch64)
  ARCH=arm64-v8a
  ;;
*)
  exit 1
  ;;
esac

URI="https://github.com/v2fly/v2ray-core/releases/latest/download/v2ray-linux-$ARCH.zip"
ZIP="$TMP/v2ray.zip"
Z1="$ZIP.tmp"
V2="$TMP/v2ray"

CURL=(
  curl
  --fail
  --location
  --create-dirs
  --no-progress-meter
  --output "$Z1"
  -- "$URI"
)

"${CURL[@]}"
mv -v --force -- "$Z1" "$ZIP"
unzip -o -d "$TMP" -- "$ZIP"
chmod +x -- "$V2"
mv -v --force -- "$TMP/"*.dat "$V2" "$DST"
