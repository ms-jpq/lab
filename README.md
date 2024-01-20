# My Infrastructure

---

- Mostly written in **bash + recursive \[makefile & m4\] macros** (think autoconf) for boomercore aesthetics.

- Idempotent deployment + total rollback

- Containerized build suite + CI verification

## Why? / How

[Ansible](https://www.ansible.com/) is slow as fuck my man.

Linux configuration is mostly based on plain ASCII files.

Use systemd [drop in mechanism](https://systemd.network/systemd.unit.html) to override vanilla configurations via [bind mounts](https://docs.docker.com/storage/bind-mounts/).

Just generate the desired configurations, make sure they do not collide in file system location + `rsync` away.

## Components

### Home Router

- [NTP](https://chrony-project.org/) sinkhole

- [DNS](https://dnsmasq.org/) sinkhole

- HTTP [transparent cache](http://www.squid-cache.org/)

- CAKE SQM for [TCP flowcontrol](https://www.bufferbloat.net/)

- [Wireguard](https://www.wireguard.com/) gateway

- [Nftables](https://wiki.nftables.org/) firewall

- [Tor](https://www.torproject.org/) transparent gateway

- Protocol sharing http, ssh on port 80

### Headless Workstation

- Disposable [systemd-nspawn](https://manpages.ubuntu.com/manpages/jammy/man1/systemd-nspawn.1.html) dev containers

- Disposable systemd managed [qemu-microvm](https://www.qemu.org/docs/master/system/i386/microvm.html) linux VMs

- Disposable systemd managed [qemu-q35](https://www.qemu.org/docs/master/system/qemu-manpage.html?highlight=q35) windows VMs

- [VFIO](https://www.kernel.org/doc/html/latest/driver-api/vfio.html) for skyrim streaming via self-hosted "cloud" [stream](https://github.com/LizardByte/Sunshine)

- [ZFS](https://openzfs.org/wiki/Main_Page) backed storage

### Storage Array + Containership

- ZFS backed storage with [policy driven snapshots](https://github.com/jimsalterjrs/sanoid)

- Hand tuned [udev](https://www.freedesktop.org/software/systemd/man/udev.html) IO policies for legacy storage array

- [iscsi](https://www.open-iscsi.com/) block shares for skyrim's 300 mods

- [smb](https://www.samba.org/) file shares for Windows clients + MacOS Time Machine

- [nfs](https://ubuntu.com/server/docs/service-nfs) file shares for Linux clients

- [Backup daemon](https://rclone.org/) into ["econ cloud"](https://www.jottacloud.com/) (wtf, how are they a viable business)

- [Systemd managed](https://podman.io/) containers

- [Intel GVT-g](https://www.intel.com/content/www/us/en/support/articles/000093216/graphics/intel-uhd-graphics-family.html) accelerated [迅雷](https://www.xunlei.com/) VM

- Linux [network namespace](https://www.man7.org/linux/man-pages/man8/ip-netns.8.html) protected torrent daemon + [`DSCP`](https://www.iana.org/assignments/dscp-registry/dscp-registry.xhtml) packet marking

- Apple [AirPrint](https://www.cups.org/) server

### TV Box

- [Socket activated](https://www.freedesktop.org/software/systemd/man/systemd.socket.html) lambda functions for IOS shortcuts

### Random VPS

- FOSS youtube / twitter / etc proxy

- Provisioned via terraform

## Some Bash Tricks

#### Recursive Try Catch

- `set -e` enables exit on any non-zero exit code

- `$0` is script name, `$@` is argument array, `[[ -v RECUR ]]` test if `RECUR` is defined

```bash
set -Eeu
set -o pipefail

if ! [[ -v RECUR ]]; then
  if RECUR=1 "$0" "$@"; then
    # success!
  else
    # failed!
  fi
fi

# ... rest of script
```

#### Deterministic, stateless globally unique IPv6 generation

- hash it 420

```bash

# Generate /56 ULA prefix from machine-id + interface name
ID="$(</etc/machine-id)+$IFACE"
SHIFT=56
ULA=$((0xfd << SHIFT))
b2sum --binary --length "$SHIFT" <<<"$ID"

# Generate lower /64 from some label, ie. wireguard client name
b2sum --binary --length 64 <<<"$LABEL"
```

#### Deterministic, IPv4 generation from IPv6 address

```bash
HEX_64=`ipv6 lower /64`
# For a given ipv4, `ipcalc-ng --json -- "$IPV4" | jq --exit-status --raw-output '.NETWORK, .NETMASK'`
IPV4_NETWORK='192.168.0.0'
IPV4_NETMASK='255.255.240.0'

printf -v V4_NET -- '%02x' ${IPV4_NETWORK//./ }
printf -v V4_MASK -- '%02x' ${IPV4_NETMASK//./ }
# Remove top 32 bits -> zero out non-identifying bits -> apply network address bits
printf -v HEX_32 -- '%x' $(("0x$HEX_64" & 0xffffffff & ~"0x$V4_MASK" | "0x$V4_NET"))

# Convert back from hex
IPV4_OCTETS="$(perl -CASD -wpe 's/(.{2})/0x$1 /g' <<<"$HEX_32")"
printf -v IPV4 -- '%d.%d.%d.%d' $IPV4_OCTETS
```

#### ☒AWS☒ - ☑Socket Activated☑ lambda functions

- Throw bash scripts behind a oauth / jwt / zero-trust gateway via HTTP layer

- Isolate script execution using systemd powered [`cgroups`](https://www.man7.org/linux/man-pages/man7/cgroups.7.html) / [`eBPF`](https://ebpf.io/) / mount namespacing, etc

```systemd
[Socket]
Accept       = yes
# Use unix stream to avoid TCP port allocation hassle
ListenStream = %t/.../%J.sock
```

```systemd
[Unit]
CollectMode    = inactive-or-failed

[Service]
Type           = oneshot
StandardInput  = socket
StandardOutput = socket
# Secure the script using systemd isolation here...
```

```bash
# This is the HTTP1.0 header structure
# Http clients like browser, nginx, curl, traefik, etc will tolerate lack of `\r`
tee <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

# stdout & stderr goes to http client
<some-command>
```

```bash
# Reading input is slightly more verbose

BYTES=0
while read -r LINE; do
  LINE="${LINE%$'\r'}"
  if [[ -z "$LINE" ]]; then
    # End of header
    break
  fi

  LHS="${LINE%%:*}"
  KEY="${LHS,,}"
  case "$KEY" in
  content-length)
    BYTES="${LINE##*: }"
    ;;
  *) ;;
  esac
done

STDIN="$(head --bytes "$BYTES")"
```

## Ideas

- Use [`g_mass_storage`](https://www.kernel.org/doc/html/latest/usb/mass-storage.html) kernel module to share ISCSI over USB to xbox

- Azure glacier storage is cheap?
