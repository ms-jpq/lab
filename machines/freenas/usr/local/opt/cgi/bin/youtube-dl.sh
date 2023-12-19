#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

read -r L1
L1="${L1#* }"
L1="${L1% *}"

tee <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

L2="${L1#/}"
L3="${L2#*:/}"

URI="https://$(sed -E -e 's/\+/ /g' -e 's/%(..)/\x\1/g' <<<"$L3")"
printf -- '%s\n' "$URI"

/var/cache/local/youtube-dl/bin --cache-dir /var/tmp --newline -- "$URI" 2>&1
figlet <<<'<3'
