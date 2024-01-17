# ISCSI

## Discovery

```bash
iscsiadm --mode discovery --type sendtargets --op new --portal '<ip/domain>'
```

```bash
iscsiadm --mode node --portal '<ip/domain>' --login
iscsiadm --mode node --portal '<ip/domain>' --logout
```

## Client

```bash
open-iscsi
```

## Server

```txt
targetcli-fb
```

## Share

```bash
# https://www.kernel.org/doc/html/latest/usb/mass-storage.html
modprobe g_mass_storage file='/...'
```
