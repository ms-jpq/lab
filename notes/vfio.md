# VFIO

After `modprobe.d` and `modules-load.d`

```bash
update-initramfs -u && update-grub
```

Verify

```bash
lspci -k | rg ...
```
