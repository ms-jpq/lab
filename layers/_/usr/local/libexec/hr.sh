#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

WORD="${1-"#"}"
COLS="${2:-"$(tput -- cols 2>/dev/null || true)"}"
COLS="${COLS:-80}"

LEN="${#WORD}"
REPS=$((COLS / LEN + 1))

ACC=()
for ((i = 0; i < REPS; i++)); do
  ACC+=("$WORD")
done

IFS='' RAW="${ACC[*]}"

printf -- '%s\n' "${RAW:0:COLS}"
