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

- [x] Scale to zero lambdas / VM / containers

- [x] Overlay networks + DNS service discovery

- [x] GPU (CUDA) access in VM / containers

- [x] SSO

- [x] Centralized alerts

### Slicing

- Deterministic IPv6

```mermaid
sequenceDiagram
  participant make
  participant machine
  participant machine_slice
  actor user

  critical AoT
    rect rgba(0, 0, 255, 0.05)
      rect rgba(0, 255, 0, 0.05)
        par
          make-->>machine : unpack .tar / .qcow2 onto COW file systems
        and
          make-->>machine : unpack kernel + initrd
        end
      end
    end
  end

  user->>machine : container / VM please

  critical almost instantaneous
    rect rgba(0, 0, 255, 0.05)
      par
        rect rgba(0, 255, 0, 0.05)
          rect rgba(255, 0, 0, 0.05)
            par
              machine-->>machine : fork COW file systems
            and
              machine-->>machine : compute deterministic IP addresses
            end
          end
          machine-->>machine : overlay cloud-init / sysprep with hostname, IP, SSH key, etc
        end
      and
        rect rgba(0, 255, 0, 0.05)
          par
            machine-->>machine : compute deterministic IP addresses
            rect rgba(255, 0, 0, 0.05)
              par
                machine-->>machine : setup DNS zone + routes
              and
                machine-->>machine : setup host <-> vm / container bridge
                machine-->>machine : setup firewall / ip forwarding rules
              end
            end
          and
            machine-->>machine : setup vm / container <-> lan macvlan/tap interface
          end
        end
      end

      machine-->>machine_slice : spawn
    end
  end

  rect rgba(0, 0, 255, 0.05)
    alt if container
      rect rgba(0, 255, 0, 0.05)
        machine_slice-->>machine_slice : /sbin/init
      end
    else if microvm (linux)
      rect rgba(0, 255, 0, 0.05)
        machine_slice-->>machine_slice : kernel boot -> /sbin/init
      end
    else if q35 (windows)
      rect rgba(0, 255, 0, 0.05)
        par
          machine-->>machine : setup ingress UNIX socket
          machine-->>machine : live reload nginx, add ingress path to UNIX socket
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

  opt
    rect rgba(0, 0, 255, 0.05)
      machine_slice-->>machine : systemd-notify ready!
    end
  end

  machine->>user : OK
```

### Lambdas

```mermaid
sequenceDiagram
  participant fat_lambda
  participant lambda
  participant system_daemon
  participant nginx_lb
  participant user

  critical
    rect rgba(0, 0, 255, 0.05)
      system_daemon-->>lambda : list lambdas
      system_daemon-->>system_daemon : setup UNIX socket for each lambda
      system_daemon-->>nginx_lb : live reload nginx, add path to each UNIX socket
    end
  end

  loop
    rect rgba(0, 0, 255, 0.05)
      user->>+nginx_lb : send request to path
      nginx_lb-->>nginx_lb : evaluate user authn / authz
      rect rgba(0, 255, 0, 0.05)
        alt if rejected
          nginx_lb-->>nginx_lb : redirect to login
        else if bite sized lambda
          rect rgba(255, 0, 0, 0.05)
            nginx_lb-->>+system_daemon : forward request to socket
            system_daemon-->>+lambda : spawn, attach request to file descriptor (fd) 3
            lambda-->>lambda : read request <fd 3
            lambda-->>lambda : process request
            lambda-->>-system_daemon : write response >fd 3
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
            lambda-->>system_daemon : forward via socket
            system_daemon-->>-nginx_lb : connect VM display to user
          end
          rect rgba(255, 0, 0, 0.05)
            opt
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
