#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3
fi

tee -- <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

read -r -d '' -- AWK <<-'EOF' || true
BEGIN { command = "stdbuf --output L -- numfmt --to si --field 2-" }

{
  if (/^\s+\w+(\s+[0-9]+)+$/) {
    print |& command
    command |& getline line
    print line
  }
  else { print }
}

END { close(command) }
EOF

show() {
  /usr/local/libexec/hr-run.sh tc -statistics qdisc show dev "$2"
}

{
  show RX cake-rx
  # shellcheck disable=SC2154
  show TX "$WAN_IF"
} | awk "$AWK"
