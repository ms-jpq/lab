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
mdsearch --user GUEST --no-pass localhost '<share>' '<query>'
# Mac
mdutil -s '/Volumes/<share>'
mdfind -onlyin '/Volumes/<share>' '<query>'
```
