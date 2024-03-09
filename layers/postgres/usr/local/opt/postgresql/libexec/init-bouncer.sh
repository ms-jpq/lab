#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

INI="$1"
shift -- 1

{
  tee -- <<-'EOF'
[databases]
EOF

  for DB in "$@"; do
    tee -- <<-EOF
$DB = dbname=postgres host=/run/local/postgresql/$DB
EOF
  done

} >"$INI"
