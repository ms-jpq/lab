# Private Cloud

- Nspawn containers

- Qemu MicroVM / Q35

## Sub-second VM / Containers

- "Daemonless" `systemd` services (in the podman sense)

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
          machine-->>machine : connect to external nfs file system
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

## Scale to zero + network activation

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
