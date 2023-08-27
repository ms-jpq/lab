# Personal Infrastructure

- Mostly written in bash + recursive \[makefile & m4\] macros (think autoconf) for boomercore aesthetics.

- Idempotent deployment + total rollback

- Containerized build suite + CI verification

WIP...

## Components

### Home Router

- [NTP](https://chrony-project.org/) blackhole

- [DNS](https://dnsmasq.org/) blackhole

- HTTP [transparent cache](http://www.squid-cache.org/)

- CAKE SQM for [TCP flowcontrol](https://www.bufferbloat.net/)

- Wireguard gateway

- [Nftables](https://wiki.nftables.org/) firewall

- Tor transparent gateway

### Headless Workstation

- Throw away [systemd-nspawn](https://manpages.ubuntu.com/manpages/jammy/man1/systemd-nspawn.1.html) dev containers

- Throw away systemd managed [qemu-q35](https://www.qemu.org/docs/master/system/qemu-manpage.html?highlight=q35) dev VMs (with SWTPM for windows 11)

- [VFIO](https://www.kernel.org/doc/html/latest/driver-api/vfio.html) for skyrim streaming via self-hosted "cloud" [stream](https://github.com/LizardByte/Sunshine)

- [ZFS](https://openzfs.org/wiki/Main_Page) backed storage

### Storage Array + Containership

- ZFS backed storage with [policy driven snapshots](https://github.com/jimsalterjrs/sanoid)

- [smb](https://www.samba.org/) shares for Windows clients + MacOS Time Machine

- [nfs](https://ubuntu.com/server/docs/service-nfs) shares for Linux clients

- [iscsi](https://www.open-iscsi.com/) block level shares for skyrim's 300 mods

- [Backup daemon](https://rclone.org/) into ["econ cloud"](https://www.jottacloud.com/) (wtf, how are they a viable business)

- Systemd managed [containers](https://podman.io/)

- Linux [network ns](https://www.man7.org/linux/man-pages/man8/ip-netns.8.html) isolated file share daemon
