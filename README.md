# My Hybrid Cloud

Welcome to my pet cloud.

## Design Goals

### DX

- [x] 100ms max iteration time

- [x] Idempotent deployment + instant rollback

- [?] Minimum maintenance, 10 year LTS

- [x] Daily + continuous CI builds

## Cloudy

- [x] Sub-second VM / Container spin up/down

- [x] Overlay networks + DNS service discovery

- [x] Scale to zero lambdas

- [x] GPU (CUDA) access in VM / Containers

- [x] SSO

- [x] Centralized alerts

### General VM / Container Flow

- Deterministic IPv6

```mermaid
sequenceDiagram
  participant make
  participant machine
  participant machine_slice
  actor user

  critical AoT
    par
      make-->>machine : unpack .tar / .qcow2 onto COW file systems
    and
      make-->>machine : unpack kernel + initrd
    end
  end

  user->>+machine : container / VM please

  critical almost instantaneous
    par
      par
        machine-->>machine : fork COW file systems
      and
        machine-->>machine : compute deterministic IP addresses
      end
      machine-->>machine : overlay cloud-init / sysprep with hostname, IP, SSH key, etc
    and
      machine-->>machine : compute deterministic IP addresses
      par
        machine-->>machine : setup DNS zone + routes
      and
        machine-->>machine : setup host <-> vm / container bridge
        machine-->>machine : setup firewall / ip forwarding rules
      and
        machine-->>machine : setup vm / container <-> lan macvlan/tap interface
      end
    end

    machine-->>machine_slice : spawn
  end

  alt if container
    machine_slice-->>machine_slice : /sbin/init
  else if microvm (linux)
    machine_slice-->>machine_slice : kernel boot -> /sbin/init
  else if q35 (windows)
    par
      machine-->>machine : setup ingress UNIX socket
      machine-->>machine : live reload nginx, add ingress path to UNIX socket
    and
      machine-->>machine : set [ingress UNIX <-> websocket <-> VNC UNIX] proxy to pending activation
    and
      machine-->>machine_slice : attach VM display to VNC UNIX socket
    and
      opt if hard drive not written to
        machine-->>machine_slice : attach windows iso / virtio drivers
      end
    end
  end

  opt
    machine_slice-->>machine : systemd-notify ready!
  end

  machine->>-user : OK
```

### Lambdas

```mermaid
sequenceDiagram
  participant system_daemon
  participant lambda

  system_daemon-->>system_daemon : list lambdas
```
