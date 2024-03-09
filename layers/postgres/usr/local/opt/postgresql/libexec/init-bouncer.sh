#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

INI="$1"
shift -- 1

{
  tee -- <<-'EOF'
[databases]
EOF

  for CLUSTER in "$@"; do
    DB="${CLUSTER#*'-'}"
    tee -- <<-EOF
$DB = dbname=postgres host=/run/local/postgresql/$CLUSTER
EOF
  done

} >"$INI"
