# UDEV

## IO Sched

```bash
printf -- '%s\n' /sys/block/*/{device/queue_depth,queue/{scheduler,nr_requests}} | xargs -- batcat --theme GitHub --
```
