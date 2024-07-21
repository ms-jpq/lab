#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

BYTES=0
while read -r LINE; do
  LINE="${LINE%$'\r'}"
  if [[ -z $LINE ]]; then
    break
  fi

  LHS="${LINE%%:*}"
  case "${LHS,,}" in
  content-length)
    BYTES="${LINE##*: }"
    ;;
  *) ;;
  esac
done

URI="$(head --bytes "$BYTES" | jq --exit-status --raw-output '.uri')"

tee <<- EOF
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

SSH=(
  ssh
  -i /var/lib/local/tv/roku.id_ed25519
  -o StrictHostKeyChecking=no
  -- administrator@roku.enp1s0.opnsense.home.arpa
  pwsh.exe '"%SYSTEMDRIVE%\Crowdstrike\firefox.ps1"'
)

"${SSH[@]}" <<< "$URI"
