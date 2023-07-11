# VFIO

After `modprobe.d` and `modules-load.d`

```bash
update-initramfs -u && update-gru
```

Verify

```bash
lspci -k | rg ...
```
