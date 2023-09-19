# Notes on File Systems

https://openzfs.github.io/openzfs-docs

## Upgrade

```bash
zpool upgrade
```

## ZFS Import

Ensure uniqueness

```bash
zpool import -d /dev/disk/by-id/ <pool>
```

## Hierarchy

```bash
zpool create -o ashift=12 -o autotrim=on <pool> mirror <dev>
zfs set canmount=off <pool>
```

```bash
zfs create -s -V <size> <pool>/<zvol>
```

```bash
zfs set atime=off xattr=sa compression=zstd mountpoint=none dnodesize=auto <pool>
```

```bash
zfs create -o mountpoint=<mount point> <pool>/<dataset>
```

## Clone

### Dependent

`<filesystem>` still depends on `<snapshot>` being around

```bash
zfs clone <snapshot> <filesystem>
```

### Promotion

Inverse relationship between `<original>` and `<cloned-filesystem>` (space preserving)

Makes it possible to destroy `<original>`

```bash
# WARNING: doing so re-homes the original snapshot trail
zfs promote <cloned-filesystem>
```

## Send Recv

```bash
# includes snapshots (--replicate)
zfs snapshot -r <snapshot>
zfs send --verbose --replicate --props <snapshot> | zfs recv -v -F <dataset>
```

```bash
# ignore snapshots (no replicate)
zfs list -t snapshot | rg <dataset>
zfs send --verbose --props <snapshot> | zfs recv -v -F <dataset>
```

## Destroy

### Prevent

```bash
zfs hold <snapshot>
zfs release <snapshot>
```

### Umount

```
zfs set canmount=noauto <dataset>
```

### `-r`

Recursive

### `-R`

Retarded -> will kill related linked datasets, (NOT just snapshots), even datasets not under `./dataset`

### Async Destroy

## Misc

### Autoexpand

```bash
zpool set autoexpand=on <pool>
```

### Remove

```bash
zpool status -g
zpool remove <pool> <guid>
```

### Time Machine

```bash
zfs set xattr=on <zpool>/<dataset>
```

### Clear

```bash
zfs inherit -r -S <property> <pool>/<dataset>
```

### Rollback / Restore

```bash
zfs rollback <dataset>@<snapshot>
```
