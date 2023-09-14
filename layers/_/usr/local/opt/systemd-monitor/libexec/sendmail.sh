#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"

CURL=(
  curl --fail
  --ssl-reqd
  --mail-from ''
  --mail-rcpt ''
)

for R in "$RUN"/*.txt; do
  N="${R##*/}"
  N="${N%.txt}"
  # FAILED["$N"]="$R"
  CURL+=(--upload-file "$R")
done

CURL+=(
  --user 'USER:password'
  -- ""
)
printf -- '%q ' "${CURL[@]}"
