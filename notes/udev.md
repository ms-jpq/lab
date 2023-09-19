# UDEV

## Query

```bash
udevadm info --query all -- </dev/...>
udevadm info --attribute-walk -- </dev/...>
```

## Reload

```bash
udevadm control --reload-rules && udevadm trigger
```

## IO Sched

```bash
printf -- '%s\n' /sys/block/*/{device/queue_depth,queue/{scheduler,nr_requests}} | xargs -- batcat --theme GitHub --
```
