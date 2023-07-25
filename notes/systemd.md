# Systemd

## Escaping

```bash
CH='-'
systemd-escape -- "$CH" # '\x2d'
i='\x2d' # %i
I='-'    # %I :: systemd-escape --unescape -- '\x2d'
```
