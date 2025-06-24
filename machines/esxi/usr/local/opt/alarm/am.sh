#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

read -r -d '' -- JSON <<- 'JSON' || true
{
  "target": "whitebox.enp1s0.opnsense.home.arpa",
  "uri": "https://www.youtube.com/watch?v=V2UGfj2qPCw"
}
JSON

curl -f -d '@-' -- http://localhost:8080/youtube.sh/ <<< "$JSON"
