#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

if [[ -f /.dockerenv ]]; then
  exit 0
fi

if ! command -v -- flatpak &>/dev/null; then
  exit 0
fi

cd -- "${0%/*}/.."

TXT="$(sed -E -ne '/^[+-]/p' -- /dev/null ./flatpaks/*.txt)"
readarray -t -- DESIRED <<<"$TXT"

PKGS="$(flatpak list --app --columns application)"
readarray -t -- INSTALLED <<<"$PKGS"

declare -A -- PRESENT=()

for PKG in "${INSTALLED[@]}"; do
  if [[ -n "$PKG" ]]; then
    PRESENT["$PKG"]=1
  fi
done

ADD=()
RM=()

for LINE in "${DESIRED[@]}"; do
  ACTION="${LINE%% *}"
  PKG="${LINE#* }"

  case "$ACTION" in
  +)
    if [[ -z "${PRESENT["$PKG"]:-""}" ]]; then
      ADD+=("$PKG")
    fi
    ;;
  -)
    if [[ -n "${PRESENT["$PKG"]:-""}" ]]; then
      RM+=("$PKG")
    fi
    ;;
  *)
    printf -- '%s%q\n' '>! ' "$LINE" >&2
    exit 1
    ;;
  esac
done

if (("${#RM[@]}")); then
  sudo -- flatpak uninstall --noninteractive --assumeyes -- "${RM[@]}"
fi

if (("${#ADD[@]}")); then
  printf -- '%q\n' "${ADD[@]}"
  sudo -- flatpak remote-add --if-not-exists -- flathub 'https://flathub.org/repo/flathub.flatpakrepo'
  sudo -- flatpak update
  sudo -- flatpak install --noninteractive --assumeyes -- "${ADD[@]}"
fi
