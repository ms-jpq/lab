#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

readarray -t -d $'\0' -- ROWS < <(jq --raw-output 'to_entries | map([.key, .value.zvol, (.value.initiators | join("\n"))] | join("\n")) | join("\u0000")' <./user_shares.json)

InitiatorName=
# shellcheck disable=SC1091
source -- '/etc/iscsi/initiatorname.iscsi'
PREFIX="${InitiatorName%%:*}"

ISCSI=/iscsi
BLOCK=/backstores/block

share() {
  NAME="$1"
  ZVOL="$2"
  shift -- 2
  INITIATORS=("$@")

  SHARE="$InitiatorName@$NAME"
  TPG="$ISCSI/$SHARE/tpg1"

  acls() {
    for INITIATOR in "${INITIATORS[@]}"; do
      if [[ -z "$INITIATOR" ]]; then
        continue
      fi

      printf -- '%s\n' "create $PREFIX:$INITIATOR"
    done
  }

  tee <<-EOF
cd /

cd $BLOCK
create $NAME /dev/zvol/$ZVOL

cd $ISCSI
create $SHARE

cd $TPG/portals
delete 0.0.0.0 3260
create ::0

cd $TPG/luns
create $BLOCK/$NAME

cd $TPG/acls
$(acls)
EOF
}

shares() {
  for ROW in "${ROWS[@]}"; do
    readarray -t -d $'\n' -- COLS <<<"$ROW"
    NAME="${COLS[0]}"

    if [[ -z "$NAME" ]]; then
      continue
    fi

    share "${COLS[@]}"
  done
}

targetcli <<-EOF
set global auto_save_on_exit=false
$(shares)

cd /
saveconfig
ls
EOF
