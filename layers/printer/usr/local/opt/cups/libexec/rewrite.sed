#!/usr/bin/env -S -- sed -E -f

s/^Listen localhost:([[:digit:]]+)$/Listen \1/g
s/(AuthType) .+$/\1 None/g
s/^Browsing .+$/Browsing Yes/g
