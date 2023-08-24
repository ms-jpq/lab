#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

targetcli <<-'EOF'
cd /
ls
clearconfig confirm=True
saveconfig
ls
EOF
