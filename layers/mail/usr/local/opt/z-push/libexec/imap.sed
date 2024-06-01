#!/usr/bin/env -S -- sed -E -f

s/('IMAP_OPTIONS', )'[^']*'/\1'\/norsh\/novalidate-cert'/
s/('IMAP_FOLDER_CONFIGURED', )false/\1true/
