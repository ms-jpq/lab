#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ARGV=(
  tofu
  -chdir="${0%/*}"
  init
  -backend-config="region=$TF_VAR_aws_region"
)

exec -- "${ARGV[@]}"