#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

NAME="$(uuidgen).ovpn"

tee -- <<- EOF
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8
Content-Disposition: attachment; filename="$NAME"

EOF

ROOT=/usr/local/opt/openvpn
DAYS=6969

SERVER_TLS_CRYPT=/var/lib/local/openvpn/tls-crypt-v2-server.key
SERVER_SSL=/var/cache/local/self-signed/ovpn
SERVER_CRT="$SERVER_SSL/ssl.crt"
SERVER_KEY="$SERVER_SSL/ssl.key"

SUBJ="/CN=$(uuidgen)"
CLIENT_CRT="$(mktemp)"
CLIENT_KEY="$(mktemp)"
CLIENT_REQ="$(mktemp)"
CLIENT_CRT_SIGNED="$(mktemp)"
CLIENT_TLS_CRYPT="$(mktemp)"

openssl req -x509 -newkey rsa:4096 -days "$DAYS" -nodes -subj "$SUBJ" -out "$CLIENT_CRT" -keyout "$CLIENT_KEY"
openssl req -new -key "$CLIENT_KEY" -subj "$SUBJ" -out "$CLIENT_REQ"
openssl req -x509 -CAcreateserial -sha256 -days "$DAYS" -CA "$SERVER_CRT" -CAkey "$SERVER_KEY" -in "$CLIENT_REQ" -out "$CLIENT_CRT_SIGNED"
openvpn --tls-crypt-v2 "$SERVER_TLS_CRYPT" --genkey tls-crypt-v2-client "$CLIENT_TLS_CRYPT"

# shellcheck disable=SC1091
source -- /usr/local/etc/default/o-0.ovpn.env

CLIENT_CA="$(< "$SERVER_CRT")"
CLIENT_CRT="$(< "$CLIENT_CRT_SIGNED")"
CLIENT_KEY="$(< "$CLIENT_KEY")"
CLIENT_TLS_CRYPT="$(< "$CLIENT_TLS_CRYPT")"

export -- OVPN_SERVER_NAME OVPN_TCP_CLIENT_PORT OVPN_UDP_PORT PROTOCOL CLIENT_CA CLIENT_CRT CLIENT_KEY CLIENT_TLS_CRYPT

cat -- "$ROOT/common.ovpn"
envsubst < "$ROOT/client.ovpn"
