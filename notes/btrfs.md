# BTRFS

## Label

```bash
btrfs filesystem label -- '/dev/disk/by-id/...' '<label>'
```

## Send Recv

```bash
# dry run
btrfs send -v --no-data -e -- 'subvol1' 'subvol2' '...'
```

```bash
btrfs send -e -- 'subvol1' 'subvol2' '...' | pv --bytes --rate --average-rate --timer | btrfs receive -e -- 'subvol'
```
