# Spotlight

```bash
# Live reload
smbctl.sh smbd reload-config
```

```bash
find /media -type f -name '.DS_Store' -delete
```

```bash
# Linux
mdsearch --configfile /usr/local/opt/samba/smb.conf --user GUEST --no-pass localhost '<share>' 'kMDItemFSName=="*"'
# Mac
mdutil -a -s
mdfind -onlyin '/Volumes/<share>' '<query>'
```
