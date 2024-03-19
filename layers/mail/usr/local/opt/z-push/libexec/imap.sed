#!/usr/bin/env -S -- sed -E -f

s/('IMAP_FOLDER_CONFIGURED', )false/\1true/
s/('IMAP_PORT', )143/\11443/
s/('IMAP_SERVER', )'localhost'/\1'127.0.0.53'/
