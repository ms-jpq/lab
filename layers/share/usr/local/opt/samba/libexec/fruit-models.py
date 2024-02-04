#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from json import dump
from plistlib import load
from sys import stdout

_PLIST = "/System/Library/CoreServices/CoreTypes.bundle/Contents/Info.plist"

with open(_PLIST, "rb") as file:
    plist = load(file)

dump(
    plist,
    stdout,
    check_circular=False,
    allow_nan=False,
    ensure_ascii=False,
    indent=2,
    sort_keys=True,
)
