#!/usr/bin/python3

from sys import argv, stdout
from uuid import NAMESPACE_URL, uuid5

name = "".join(argv[1:])
stdout.write(str(uuid5(namespace=NAMESPACE_URL, name=name)))
