# Network Design

## DNS

- Machines are responsible for DNS queries on their subdomains, recursively.

- i.e. Root machines are queried for **`[A -> B]`**, next level machines are queried for **`[C -> D]`**, and so so.

```mermaid
flowchart LR
  machine1["< root domain / machine >"] -- (A) --> interface1["< ifname >"]
  machine1 -- (A) --> interface2["< ifname >"]
  interface1 -- (B) --> machine2["< machine name >"]
  machine2 -- (C) --> interface3["< ifname >"]
  machine2 -- (C) --> interface4["< ifname >"]
  interface3 -- (D) --> host1["< machine / VM / container >"]
  interface3 -- (D) --> host2["< machine / VM / container >"]
  interface4 -- (D) --> host3["< machine / VM / container >"]
  interface2 -- (B) --> machine3["< machine name >"]
  machine3 -- (C) --> interface5["< ifname >"]
```

## IP allocations

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

### IPv6

ULA - `120/128` bits of freedom, enough bytes for **globally unique deterministic hashing** → BLAKE3

- `48` bits for machine-id derived **globally unique** subnet (upper `fd**:****:****:****::/56`)

- `64` bits for machine-id derived **globally unique** `SLAAC` address suffix (lower `::****:****:****:****/64`)

- `16` bits left for machine local interfaces (sequential ID), **deterministically ordered** via `udev` naming scheme for "physical" interfaces and first come, first served for virtual interfaces

Stateless global topology.

Stateless `host` → `VM / container` topology, since `host` has prior knowledge of `VM / container` ID as hash inputs.

### IPv4

Private ranges - `{24,20,16}/32` bits of freedom, insufficient entropy for stateless solutions.

```mermaid
flowchart TB
  pool["all private subnets"] -- initial --> used["subtract unavailable subnets"]
  mark["mark subnets unavailable"] -- initial --> used
  used --> unused["sort available subnets by size"]
  unused --> alloc["allocate network from smallest available subnet"]
  alloc --> used
```

## Overlay Network

Site to Site WireGuard gateways.

## Load Balancer + ACL

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
      haproxy_nginx -->> haproxy_nginx : Failed auth rate limit?
      haproxy_nginx -->>- nginx: Auth status
    end
    alt auth failed
      nginx -->> user : Authn redirect / Authz denied
    else auth ok
      rect rgba(255, 0, 0, 0.05)
        nginx -->>+ http_srv : Forward request
        http_srv -->>- nginx: HTTP response
        nginx -->> user : Forward response
      end
    end
  end

  rect rgba(0, 0, 255, 0.05)
    user -->> nginx : IMAP + TLS
    nginx -->>+ haproxy_nginx : User IP + auth headers
    rect rgba(0, 255, 0, 0.05)
      haproxy_nginx -->> haproxy_nginx : Failed auth rate limit?
      haproxy_nginx -->>- nginx: Auth status
    end
    alt auth failed
      nginx -->> user : Nein!
    else auth ok
      rect rgba(255, 0, 0, 0.05)
        nginx -->>+ mda : Forward request
        mda -->>- nginx: IMAP response
        nginx -->> user : You got mail
      end
    end
  end

  rect rgba(0, 0, 255, 0.05)
    user -->> nginx : SMTP + TLS (optional)
    nginx -->>+ haproxy_nginx : User IP + auth headers
    rect rgba(0, 255, 0, 0.05)
      haproxy_nginx -->> haproxy_nginx : Failed auth rate limit?
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
```
