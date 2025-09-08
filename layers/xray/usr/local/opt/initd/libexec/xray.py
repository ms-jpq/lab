#!/usr/bin/env -S -- python3

from json import dump
from sys import argv, stdin, stdout

from yaml import safe_load

conf = safe_load(stdin)
dump(conf["".join(argv[1:])], stdout, sort_keys=True, indent=2)
