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

JSON="$(head --bytes "$BYTES")"
TARGET="$(jq --exit-status --raw-output '.target' <<< "$JSON")"
URI="$(jq --exit-status --raw-output '.uri' <<< "$JSON")"

tee <<- EOF
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

# https://github.com/yuliskov/SmartTube/issues/1999
CMD=(
  am start
  -a android.intent.action.VIEW
  -d "$URI"
  com.teamsmart.videomanager.tv
)
printf -v COMMAND -- '%q ' "${CMD[@]}"

# shellcheck disable=SC2154
export -- HOME="$ANDROID_USER_HOME"

adb connect "$TARGET"
adb shell -T input keyevent KEYCODE_WAKEUP
adb shell -T "$COMMAND"
