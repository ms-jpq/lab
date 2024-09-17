# ZFS

https://openzfs.github.io/openzfs-docs

## Upgrade

```bash
zpool upgrade
```

## ZFS Import

Ensure uniqueness

```bash
zpool import -d /dev/disk/by-id/ '<pool>'
zpool import -d /dev/disk/by-id/ -a -f
```

## Hierarchy

```bash
# ashift=12 on HDDs
zpool create -o ashift=13 -o autotrim=on '<pool>' mirror '/dev/disk/by-id/...'
```

```bash
zfs set canmount=off mountpoint=none atime=off xattr=sa compression=zstd dnodesize=auto '<pool>'
```

```bash
zfs create -s -V '<size>' '<pool>/<zvol>'
zfs set volsize='<...G>' '<pool>/<zvol>'
```

```bash
zfs create -o mountpoint='<mount point>' '<pool>/<dataset>'
```

## Encryption

```bash
zfs create -o encryption=on -o keyformat=passphrase -o keylocation='file:///var/lib/local/zfs/...' '<pool>/<dataset>'
```

## Clone

### Dependent

`<filesystem>` still depends on `<snapshot>` being around

```bash
zfs clone '<snapshot>' '<filesystem>'
```

### Promotion

Inverse relationship between `<original>` and `<cloned-filesystem>` (space preserving)

Makes it possible to destroy `<original>`

```bash
# WARNING: doing so re-homes the original snapshot trail
zfs promote '<cloned-filesystem>'
```

## Send Recv

```bash
# includes snapshots (--replicate)
zfs snapshot -r '<snapshot>'
zfs send --verbose --replicate --props -- '<snapshot>' | zfs recv -v -F -- '<dataset>'
```

```bash
pv --bytes --rate --average-rate --timer --eta --fineta --progress
```

```bash
# ignore snapshots (no replicate)
zfs list -t snapshot | rg '<dataset>'
zfs send --verbose --props -- '<snapshot>' | zfs recv -v -F -- '<dataset>'
```

## Destroy

### Prevent

```bash
zfs hold '<snapshot>'
zfs release '<snapshot>'
```

### Umount

```bash
zfs set canmount=noauto '<dataset>'
```

### `-r`

Recursive

### `-R`

**Regarded** → will kill related linked datasets, (NOT just snapshots), even datasets not under `./dataset`

### Async Destroy

## Misc

### Autoexpand

```bash
zpool set autoexpand=on '<pool>'
```

### Remove

```bash
zpool status -g
zpool remove '<pool>' '<guid>'
```

### Clear

```bash
zfs inherit -r -S '<property>' '<pool>/<dataset>'
```

### Rollback / Restore

```bash
zfs rollback '<dataset>@<snapshot>'
```
