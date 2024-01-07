#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

ARGV=(
  tofu init
  -backend-config="bucket=$TF_VAR_s3_state_bucket"
  -backend-config="region=$TF_VAR_aws_region"
  -backend-config="dynamodb_table=$TF_VAR_s3_state_bucket"
)

exec -- "${ARGV[@]}"
