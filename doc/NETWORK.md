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

WireGuard gateways
