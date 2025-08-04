#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CHUNK=99
INDEX='test'

if ! [[ -v UNDER ]]; then
  DIR="$1"
  ES="${2:-"http://localhost:9200"}"
  PROCS="$(nproc)"
  PROCS=$((PROCS * 2))

  FIND=(
    env
    --chdir "$DIR"
    -- fdfind
    --hidden
    --no-ignore-vcs
    --print0
    --show-errors
    --absolute-path
  )
  CURL=(
    curl
    --fail-with-body
    --location
    --no-progress-meter
    --header 'Content-Type: application/x-ndjson'
    --data-binary '@-'
    -- "$ES/_bulk"
  )
  P1=(
    parallel
    --quote
    --null
    --jobs "$PROCS"
    -- exec -- "$0" "$DIR"
  )
  P2=(
    parallel
    --quote
    --pipe
    --round-robin
    --jobs "$PROCS"
    -L $((CHUNK * 2))
    --line-buffer
    -- "${CURL[@]}"
  )
  "${FIND[@]}" | UNDER=1 HOME=/tmp "${P1[@]}" | HOME=/tmp "${P2[@]}"
else
  DIR="$1"
  FILE="$2"
  LEN="${#DIR}"

  if [[ -z $FILE ]]; then
    exit
  fi
  if [[ -L $FILE ]]; then
    if ! FILE="$(realpath -- "$FILE")"; then
      exit
    fi
    if [[ ${FILE:0:LEN} != "$DIR" ]]; then
      exit
    fi
  fi

  ITIME="${EPOCHREALTIME%%.*}"
  BASENAME="${FILE##*/}"
  EXT=''
  if ! [[ -d $FILE ]]; then
    if [[ $FILE =~ .+(\.[^.]+)$ ]]; then
      EXT="${BASH_REMATCH[1]}"
    fi
  fi
  MIME="$(file --brief --mime -- "$FILE")"
  ST="$(stat --format '%u %g %s %Y' -- "$FILE")"
  read -r -- FUID FGID SIZE MTIME <<< "$ST"
  read -r -d '' -- SCRIPT <<- 'JQ' || true
{
  "attributes": {
    "group": $group,
    "owner": $user
  },
  "file": {
    "content_type": $mime,
    "extension": $ext,
    "filename": $basename,
    "filesize": $size,
    "indexing_date": $itime,
    "last_modified": $mtime
  },
  "path": {
    "real": $path
  }
}
JQ
  JQ=(
    jq
    --exit-status
    --null-input
    --compact-output
    --arg basename "$BASENAME"
    --arg ext "$EXT"
    --arg mime "$MIME"
    --arg path "$FILE"
    --argjson group "$FGID"
    --argjson itime "$ITIME"
    --argjson mtime "$MTIME"
    --argjson size "$SIZE"
    --argjson user "$FUID"
    "$SCRIPT"
  )

  tee -- <<- JSON || true
{ "index": { "_index": "$INDEX" } }
JSON
  exec -- "${JQ[@]}"
fi
