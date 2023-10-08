#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from json import dump
from sys import stdin, stdout

from yaml import safe_load

conf = safe_load(stdin)
conf.pop("_")
dump(conf, stdout, sort_keys=True, indent=2)
