# My Infrastructure

- Mostly written in **bash + recursive \[makefile & m4\] macros** (think autoconf) for boomercore aesthetics.

- Idempotent deployment + total rollback

- Containerized build suite + CI verification

WIP...

## Why? / How

[Ansible](https://www.ansible.com/) is slow as fuck my man.

Linux configuration is mostly based on plain ASCII files.

Use [systemd](https://systemd.network/systemd.unit.html) drop in mechanism to override vanilla configurations via [bind mounts](https://docs.docker.com/storage/bind-mounts/).

Just generate the desired configurations, make sure they do not collide in file system location + `rsync` away.

## Components

### Home Router

- [NTP](https://chrony-project.org/) blackhole

- [DNS](https://dnsmasq.org/) blackhole

- HTTP [transparent cache](http://www.squid-cache.org/)

- CAKE SQM for [TCP flowcontrol](https://www.bufferbloat.net/)

- [Wireguard](https://www.wireguard.com/) gateway

- [Nftables](https://wiki.nftables.org/) firewall

- [Tor](https://www.torproject.org/) transparent gateway

- [Certbot](https://certbot.eff.org/) daemon

- [ssl alpn](https://en.wikipedia.org/wiki/Application-Layer_Protocol_Negotiation) based TCP port 443 sharing with HTTPS & SSH

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

- [Intel GVT-g](https://www.intel.com/content/www/us/en/support/articles/000093216/graphics/intel-uhd-graphics-family.html) accelerated [迅雷](https://www.xunlei.com/) VM

- Linux [network namespace](https://www.man7.org/linux/man-pages/man8/ip-netns.8.html) protected torrent daemon

### Random VPS

- FOSS youtube / twitter / etc proxy

- Provisioned via terraform
