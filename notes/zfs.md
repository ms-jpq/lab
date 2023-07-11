# Notes on Filesystems

## Destroy

```
zfs set canmount=noauto <dataset>
```

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
zpool create -o ashift=12 <pool> mirror <dev>
zfs set canmount=off <pool>
```

```bash
zfs create -s -V <size> <pool>/<zvol>
```

```bash
zfs set autotrim=on atime=off xattr=sa compression=zstd mountpoint=none dnodesize=auto <pool>
```

```bash
zfs create -o mountpoint=<mount point> <pool>/<dataset>
```

## Performance

### Upgrade

```bash
zpool upgrade <pool>
```

### Destroy

#### `-r`

Recursive

#### `-R`

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

### Send Recv

```bash
# includes snapshots (--replicate)
zfs snapshot -r <snapshot>
zfs send --verbose --replicate --props <snapshot> | zfs recv -v -F <dataset>
```

### Clone

```bash
# ignore snapshots (no replicate)
zfs list -t snapshot | rg <dataset>
zfs send --verbose --props <snapshot> | zfs recv -v -F <dataset>
```

### Clear

```bash
zfs inherit -r -S <property> <pool>/<dataset>
```

### Rollback / Restore

```bash
zfs rollback <dataset>@<snapshot>
```
