# UDEV

## Query

```bash
udevadm info --query all -- '</dev/...>'
udevadm info --attribute-walk -- '</dev/...>'
udevadm info --query all -- '/sys/class/net/...'
udevadm info --attribute-walk -- '/sys/class/net/...'
```

## Reload

```bash
udevadm control --log-priority debug
journalctl --follow --unit systemd-udevd
udevadm control --reload-rules && udevadm trigger
```

## IO Sched

```bash
printf -- '%s\n' /sys/block/*/{device/queue_depth,queue/{scheduler,nr_requests}} | xargs --no-run-if-empty -- batcat --theme GitHub --
```
