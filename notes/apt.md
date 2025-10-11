# Reconfigure DPKG

```bash
sudo -- rm -fr -v -- /var/lib/dpkg/info/dpkg*
sudo -- dpkg --configure -a
```
