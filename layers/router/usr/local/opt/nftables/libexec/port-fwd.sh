#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

# readarray -t -d $'\n' -- LINES < <(jq -r 'to_entries[] | "\(.key) \(.value | to_entries[] | "\(.key) . \(.value[])")"' <<<"$PORTS")

# declare -A -- SPEC

# for LINE in "${LINES[@]}"; do
#   NAME="${LINE%% *}"
#   NAME="${NAME,,}."
#   PORT="${LINE#* }"
#   SPEC[$NAME]="$PORT"$'\n'"${SPEC["$NAME"]:-}"
# done

# declare -A -- SEEN

# add() {
#   DOMAIN="$1"
#   PORT="$2"
#   IP="$3"
#   SVC="${PORT#* }"

#   if [[ "$IP" =~ : ]]; then
#     if [[ "$IP" =~ ^fd ]]; then
#       if [[ -z "${SEEN["$PORT"]:-}" ]]; then
#         SEEN["$PORT"]=1
#         printf -- '%s\n' "add element inet user fw_v6 { $PORT : $IP $SVC }"
#       fi
#     else
#       printf -- '%s\n' "add element inet user pass_v6 { $PORT . $IP }"
#     fi
#   else
#     printf -- '%s\n' "add element inet user fw_v4 { $PORT : $IP $SVC }"
#   fi

# }

# while true; do
#   T1="$(mktemp --directory)"
#   for DOMAIN in "${!SPEC[@]}"; do
#     dig +short "$DOMAIN" AAAA "$DOMAIN" A >"$T1/$DOMAIN" &
#   done

#   if wait; then
#     :
#   fi

#   SEEN=()
#   T2="$(mktemp)"
#   tee -- "$T2" >/dev/null <<-'EOF'
# flush set inet user pass_v4
# flush set inet user pass_v4
# flush map inet user fw_v4
# flush map inet user fw_v6
# EOF
#   for DOMAIN in "${!SPEC[@]}"; do
#     readarray -t -d $'\n' -- IPS <"$T1/$DOMAIN"
#     readarray -t -d $'\n' -- MAPPING <<<"${SPEC["$DOMAIN"]}"

#     for PORT in "${MAPPING[@]}"; do
#       if [[ -n "$PORT" ]]; then
#         for IP in "${IPS[@]}"; do
#           add "$DOMAIN" "$PORT" "$IP"
#         done
#       fi
#     done
#   done >>"$T2"

#   nft --file "$T2"
#   rm --recursive --force -- "$T1" "$T2"
#   sleep -- 60
# done
