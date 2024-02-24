# UDEV

## Query

```bash
df --si --print-type
udevadm info --query all -- '/dev/...'
udevadm info --attribute-walk -- '/dev/...'
```

```bash
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
printf -- '%s\0' /sys/block/*/{device/queue_depth,queue/{scheduler,nr_requests}} | xargs --no-run-if-empty --null -- batcat --theme GitHub --
```
