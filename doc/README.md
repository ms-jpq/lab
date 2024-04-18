# Walk Through

"We have cloud at home" - mom

## Think Mark, Think

If you had 5 days vs. 5 weeks vs. 5 months vs. 5 years to think about a problem, how would your solution differ?

---

# Design Goals

- [x] 100ms max incremental builds, ~1s feedback loop

- [x] Idempotent deployment, ubiquitous sandboxing, quick & clean rollback

- [x] Daily + continuous CI verification

- [x] Minimum maintenance

---

# Constituents

- Sub-second VM / Container instantiation

- Scale to zero + network activated lambdas / VM / Containers

- Overlay networks + recursive DNS service discovery / registration

- GPU (CUDA & mdev) VM / containers

- Durable Postgres IaC

- Crash consistent DB / VM / Container snapshots

- Log aggregation + live alerts

- HTTP + IMAP single sign on

- Wireguard + OpenVPN Gateways + SSH bastion

- ...etc

---

# Passion Project

Labour of ~~love?~~ **hate**.

- Why the hell is there a version on everything in k8s?

  - Just gonna break at inconvenient time

- This library is 5 years old and has 7 major versions?

- Why is Ansible so slow and keeps getting slower?

  - Why does it have 16 levels of variable precedence?

- Generalized annoyance

  - Lots of Microk8s scripts don't even have basic `-e` error checking?

  - LXD (Canonical's OpenShift) sending SIGKILL instead of SIGTERM to display daemons, thus making cleaning up impossible.

  - et al.

---

# Complexity

```mermaid
mindmap
  root)Linux(
    ((Network))
      (DNS)
        Local
          DHCP Domains
          mdns["mDNS (Bonjour)"]
          Recursive Routing
          Packet Redirect
          Deterministic IPv6
        Public
          DDNS
            Cloudflare API
          Terraform IAC
            Route53
            LightSail
      (VPN Overlays)
        OpenVPN
          Port Sharing
        Wireguard
      (Ingress)
        Application Layer
        Transport Layer
          TCP
            TLS
              Lets Encrypt
              OpenSSL
          UDP
    ((Storage))
      (Copy on Write)
        Policy Based Snapshots
        Maintenance
          Defragmentation
          Scrubbing
          TRIM
      (Object - S3)
        AWS
        S3 API
      (RDMBS)
        PostgreSQL
      (Sharing)
        WebDav
        NFS
        SMB
        ISCSI
    ((Isolation))
      (VMs)
        Cloud-Init
        MicroVMs
          Kernel Boot
        Full Emulation
          Software TPM
          TCP ↔ Websocket
      (Containers)
        Nspawn
        OCI
      (Lambdas)
    ((GPU))
      CUDA
      VFIO
      MDEV
    ((Aggeration))
      (Logging)
      (Push Alerts)
        Mail
        Active Sync
    ((Performance))
      (Monitoring)
      (Tuning)
        TCP Congestion Control
        IO Scheduler / Queuing
        Packet Prioritization
        ZFS Parameters
    ((Security))
      (Network + Transport Layer)
        Firewall
        Segmentation
      (Protocol Layer)
        HTTP
        SMTP
        IMAP
    ((Misc))
      (OpenPGP)
        Public APT Repo
          Package Pipeline
          Background Update
        Secret Store
      NTP
      CUPS
      Github Mirror
```

---

# Reducing Complexity

Over half a decade of thinking about it

## Prior Art

- Ansible ⇒ Popular desired state configuration tool

- LXD / Libvirt ⇒ Canonical / Red Hat's Container + VM orchestration platforms

- Dockerd / k8s

- Systemd-Nspawn

---

# Containers

- **Orthogonality**: Ensuring independence of service environments

- **Standardization**: Ensuring generality of service interfaces

- **Logistics**: Ensuring delivery of service dependencies

---

# ~~Magnets~~ containers how do they work?

- We live in the world of ~~containers~~ systemd

  - cgroups

  - network namespace

  - mount namespace

  - local DNS server

  - OSI transport layer proxies

  - unified log driver

  - etc.

## Modern container runtimes

> Why are we rewriting Linux daemons, when Linux has a system daemon

```json
{ "exec-opts": ["native.cgroupdriver=systemd"] }
```

```yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
---
cgroupDriver: systemd
```

---

# Non Sequitur: Executable Load order

## Program Search Path

```bash
printf -- %s "$PATH" | tr -- ':' '\n'
```

```txt
/usr/local/sbin
/usr/local/bin
/usr/sbin
/usr/bin
/sbin
/bin
/usr/games
/usr/local/games
```

## Systemd Search Path

```txt
/etc/systemd/system.control/*
/run/systemd/system.control/*
/run/systemd/transient/*
/run/systemd/generator.early/*
/etc/systemd/system/*
/etc/systemd/system.attached/*
/run/systemd/system/*
/run/systemd/system.attached/*
/run/systemd/generator/*
…
/usr/lib/systemd/system/*
/run/systemd/generator.late/*
```

---

# 💡

**Q:** Why does `homebrew (x86)` install everything under `/usr/local/*`

    Because it's empty

**Q:** Does `Systemd` load configurations from `/usr/local/*`?

    Yes

**Q:** Does `Systemd` allow service configuration overriding?

    Yes, Yes

**Q:** Is it possible override inviduiual service configurations such that the private mountspace of each service load configurations from `/usr/local/*`?

    Yes, yes, yes

**Q:** Put everything under `/usr/local/*` and make `/` immutable?

    Yes, yes, yes, yes

---

# ~~OCI~~ Systemd Containers

```yaml
# docker-compose.yml
volumes:
  - ./main.nginx:/etc/nginx/nginx.conf:ro
```

I regret not making systemd enforce maximum isolation by default - Lennart Poettering

```systemd
# /usr/local/lib/systemd/system/nginx.service.d/0-override.conf

# treat read-only `/` as OCI base image layer
[Service]
ProtectSystem     = strict
ReadWritePaths    = /run /var/tmp
BindReadOnlyPaths = /usr/local/opt/nginx/conf/main.nginx:/etc/nginx/nginx.conf
```

## Control-Alt-Delete

```bash
rm -fr -- /usr/local/*
```

---

# Everything is a file

- UNIX configurations are just files

- Build desired `/usr/local/*` file set via layering of desired configurations

- Sync to target machines

- Reload or restart system services if configuration differs

```txt
.
├── facts
│  └── (...).{env,json}
├── layers
│  └── (...)/
├── machines
│  └── (...)/
├── makelib
│  └── (...).mk
└── terraform
   └── (...)
```

---

# Everything everywhere, at once

- Local make → SSH send script → Cached envfile of remote machine

- Local make → SSH pipe lining → Remote make

```mermaid
sequenceDiagram
  actor make as GNUMake
  participant machine1 as Machine
  participant machine2 as Machine

  par
    rect rgba(0, 0, 255, 0.05)
      par
        make-->>make : cp files / links
      and
        opt cached
          rect rgba(0, 255, 0, 0.05)
            make-->>+machine2 : env?
            machine2-->>-make : nproc, hosttype, version_id, etc.
          end
        end
        make-->>make : m4 templates
      and
        make-->>make : deference links that begin with `!`
      end
      make->>machine2 : rsync deltas
      machine2-->>machine2 : make deltas
    end
  and
    rect rgba(0, 0, 255, 0.05)
      par
        make-->>make : cp files / links
      and
        opt cached
          rect rgba(0, 255, 0, 0.05)
            make-->>+machine1 : env?
            machine1-->>-make : nproc, hosttype, version_id, etc.
          end
        end
        make-->>make : m4 templates
      and
        make-->>make : deference links that begin with `!`
      end
      make->>machine1 : rsync deltas
      machine1-->>machine1 : make deltas
    end
  end
```

---

# Sub-second VM / Containers

- "Daemonless" `systemd` services (in the `podman` sense)

- Concurrent initialization

```mermaid
sequenceDiagram
  participant machine as Machine
  participant machine_slice as VM / Container
  actor user

  critical ahead of time cache
    rect rgba(0, 0, 255, 0.05)
      rect rgba(0, 255, 0, 0.05)
        par
          machine-->>machine : unpack .tar / .qcow2 onto COW file systems (brtfs, zfs, xfs for reflink only)
        and
          machine-->>machine : unpack kernel + initrd
        end
      end
    end
  end

  user->>+machine : container / VM please

  critical almost instantaneous
    rect rgba(0, 0, 255, 0.05)
      par
        rect rgba(0, 255, 0, 0.05)
          rect rgba(255, 0, 0, 0.05)
            par
              machine-->>machine : fork COW file systems
            and
              machine-->>machine : provision DNS zone + network toplogy
            end
          end
          machine-->>machine : overlay cloud-init / sysprep with hostname, IP, SSH key, etc
        end
      and
        rect rgba(0, 255, 0, 0.05)
          par
            machine-->>machine : provision DNS zone + network toplogy
            machine-->>machine : setup host <-> vm / container bridge
            machine-->>machine : setup firewall / ip forwarding rules
          and
            machine-->>machine : setup vm / container <-> external macvlan/tap interface
          end
        end
      and
        opt Q35 VM
          rect rgba(0, 255, 0, 0.05)
            machine-->>machine : spawn TPM daemon
          end
        end
      end
      rect rgba(0, 255, 0, 0.05)
        alt Container
          machine-->>machine : auto mount external nfs file system
        else VM
          machine-->>machine : connect to external iscsi block storage
        end
      end
      machine-->>machine_slice : spawn
    end
  end

  rect rgba(0, 0, 255, 0.05)
    alt if container
      rect rgba(0, 0, 255, 0.05)
        machine_slice-->>machine : systemd-notify ready!
      end
    else if q35 (windows)
      rect rgba(0, 255, 0, 0.05)
        par
          machine-->>machine : setup ingress UNIX socket
        and
          machine-->>machine : set [ingress UNIX <-> websocket <-> VNC UNIX] proxy to pending activation
        and
          machine-->>machine_slice : attach VM display to VNC UNIX socket
        and
          rect rgba(255, 0, 0, 0.05)
            opt if hard drive not written to
              machine-->>machine_slice : attach windows iso / virtio drivers
            end
          end
        end
      end
    end
  end

  machine->>-user : OK
```

---

# Scale from zero + network activation

- Network socket activated services

- Shutdown on idle

```mermaid
sequenceDiagram
  participant fat_lambda as Fat Lambda
  participant lambda as Lambda
  participant system_daemon as System Daemon
  participant nginx_lb as Load Balancer
  participant user as User

  critical
    rect rgba(0, 0, 255, 0.05)
      system_daemon-->>lambda : enumerate lambda functions
      system_daemon-->>system_daemon : setup UNIX socket for each function
      system_daemon-->>nginx_lb : live reload nginx, add path to each UNIX socket
    end
  end

  loop
    rect rgba(0, 0, 255, 0.05)
      user->>+nginx_lb : send request to `/<path>`
      nginx_lb-->>nginx_lb : protocol layer authn / authz
      rect rgba(0, 255, 0, 0.05)
        alt if rejected
          nginx_lb-->>nginx_lb : redirect for auth
        else if function sized lambda
          rect rgba(255, 0, 0, 0.05)
            nginx_lb-->>+system_daemon : forward request to socket
            system_daemon-->>+lambda : spawn, attach request to file descriptor (fd) 3
            lambda-->>lambda : read request <fd 3
            lambda-->>lambda : process request
            lambda-->>-system_daemon : stream response >fd 3
            system_daemon-->>-nginx_lb : forward response from socket
          end
        else if fat lambda, ie. windows VM
          rect rgba(255, 0, 0, 0.05)
            nginx_lb-->>+system_daemon : forward request to socket
            rect rgba(255, 255, 0, 0.05)
              par
                system_daemon-->>lambda : spawn long lived websocket proxy
              and
                system_daemon-->>fat_lambda : start VM if not already started
              end
            end
            rect rgba(255, 255, 0, 0.05)
              loop
                lambda-->>fat_lambda : send keyboard + mouse movements
                fat_lambda-->>lambda : send display updates
              end
            end
            lambda-->>system_daemon : transport forwarding
            system_daemon-->>-nginx_lb : connect VM display to user
          end
          rect rgba(255, 0, 0, 0.05)
            opt shutdown on idle transport
              rect rgba(255, 255, 0, 0.05)
                par
                  system_daemon-->>lambda : shutdown on socket inactivity
                and
                  system_daemon-->>fat_lambda : shutdown on socket inactivity
                end
              end
            end
          end
        end
      end
      nginx_lb->>-user : response
    end
  end
```

---

# Durable Postgres IaC

- Continuous & incremental snapshots

```mermaid
flowchart LR
  client1["client"] -- user1:pass2@host/dbname1 --> pg_bouncer["proxy"]
  client2["client"] -- user1:pass2@host/dbname2 --> pg_bouncer
  client3["client"] -- user2:pass3@host/dbname3 --> pg_bouncer
  pg_bouncer --> postgres1["postgres"]
  pg_bouncer --> postgres2["postgres"]
  pg_bouncer --> postgres3["postgres"]
  postgres1 --> cow1["copy on write filesystem"]
  postgres2 --> cow2["copy on write filesystem"]
  postgres3 --> cow3["copy on write filesystem"]
  cow1 --> blk["abstract block device"]
  cow2 --> blk
  cow3 --> blk
```

---

# DNS

- Machines are responsible for DNS queries on their subdomains, recursively.

- i.e. Root machines are queried for **`[A -> B]`**, next level machines are queried for **`[C -> D]`**, and so so.

```mermaid
flowchart LR
  machine1["< root domain / machine >"] -- A --> interface1["< ifname >"]
  machine1 -- A --> interface2["< ifname >"]
  interface1 -- B --> machine2["< machine name >"]
  machine2 -- C --> interface3["< ifname >"]
  machine2 -- C --> interface4["< ifname >"]
  interface3 -- D --> host1["< machine / VM / container >"]
  interface3 -- D --> host2["< machine / VM / container >"]
  interface4 -- D --> host3["< machine / VM / container >"]
  interface2 -- B --> machine3["< machine name >"]
  machine3 -- C --> interface5["< ifname >"]
```

---

# IP allocations

- Zero coordination: Globally unique addresses, trivially routable DNS → IP.

- Internal coordination: Machine level locking, machines handle DNS → IP translation via `DHCP` leases.

- Centralized coordination: IPv4 partitioning mechanism.

```mermaid
flowchart LR
  local --> maybe1{stateful?}
  maybe1 -- yes --> local_l["machine internal coordination"]
  maybe1 -- no --> lock_free["zero coordination"]
  global --> maybe2{stateful?}
  maybe2 -- no --> lock_free["zero coordination"]
  maybe2 -- yes --> global_l["centralized coordination"]
```

---

# IPv6

ULA - `120/128` bits of freedom, enough bytes for **globally unique deterministic hashing** → BLAKE3

- `48` bits for machine-id derived **globally unique** subnet (upper `fd**:****:****::/48`)

- `64` bits for machine-id derived **globally unique** `SLAAC` address suffix (lower `::****:****:****:****/64`)

- `16` bits left for machine local interfaces (sequential ID), **deterministically ordered** via `udev` naming scheme for "physical" interfaces and first come, first served for virtual interfaces

Stateless global topology.

Stateless `host` → `VM / container` topology, since `host` has prior knowledge of `VM / container` ID as hash inputs.

---

# IPv4

Private ranges - `{24,20,16}/32` bits of freedom, insufficient entropy for stateless solutions.

```mermaid
flowchart TB
  pool["all private subnets"] -- initial --> used["subtract unavailable subnets"]
  mark["mark subnets unavailable"] -- initial --> used
  used --> unused["sort available subnets by size"]
  unused --> alloc["allocate network from smallest available subnet"]
  alloc --> used
```

---

# Overlay Network

Site to Site WireGuard gateways.

---

# Load Balancer + ACL

- MTA: Mail Transfer Agent

- MDA: Mail Delivery Agent

```mermaid
sequenceDiagram
  actor user as User
  participant nginx as Load Balancer
  participant letsencrypt as Certificate Authority
  participant haproxy_nginx as Auth Server
  participant http_srv as HTTP Services
  participant mda as MDA
  participant mta as MTA

  rect rgba(0, 0, 255, 0.05)
    nginx -->>+ letsencrypt: HTTP-01 challenge
    letsencrypt -->>- nginx: Certificate
  end

  rect rgba(0, 0, 255, 0.05)
    user -->> nginx : HTTP + TLS
    nginx -->>+ haproxy_nginx : User IP + auth headers
    rect rgba(0, 255, 0, 0.05)
      haproxy_nginx -->> haproxy_nginx : Auth(z/n) + failure rate limit verify
      haproxy_nginx -->>- nginx: Auth status + auth cookie
    end
    alt auth failed
      nginx -->> user : Authn redirect / Authz denied
    else auth ok
      rect rgba(255, 0, 0, 0.05)
        nginx -->>+ http_srv : Forward request
        http_srv -->>- nginx: HTTP response
        nginx -->> user : Forward response + auth cookie
      end
    end
  end

  rect rgba(0, 0, 255, 0.05)
    user -->> nginx : SMTP + TLS (optional)
    nginx -->>+ haproxy_nginx : User IP + auth headers
    rect rgba(0, 255, 0, 0.05)
      haproxy_nginx -->> haproxy_nginx : Auth(z/n) + failure rate limit verify
      haproxy_nginx -->>- nginx: Auth status
    end
    alt auth failed
      nginx -->> user : Nein!
    else auth ok
      rect rgba(255, 0, 0, 0.05)
        nginx -->>+ mta : Forward mail
        par
          rect rgba(255, 255, 0, 0.05)
            mta -->>+ mda: Forward mail
            mda -->>- mta: Ack
          end
        and
          mta -->>- nginx: SMTP response
        end
        nginx -->> user : Sent!
      end
    end
  end

  rect rgba(0, 0, 255, 0.05)
    user -->> nginx : IMAP + TLS
    nginx -->>+ haproxy_nginx : User IP + auth headers
    rect rgba(0, 255, 0, 0.05)
      haproxy_nginx -->> haproxy_nginx : Auth(z/n) + failure rate limit verify
      haproxy_nginx -->>- nginx: Auth status
    end
    alt auth failed
      nginx -->> user : Nein!
    else auth ok
      rect rgba(255, 0, 0, 0.05)
        nginx -->>+ mda : Forward request
        mda -->>- nginx: IMAP response
        nginx -->> user : You got mail!
      end
    end
  end
```
