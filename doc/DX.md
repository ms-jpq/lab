# DX

## 100ms iterations + minimal maintenance

Classic UNIX tools

- Brutally **ossified** → religiously forward compatible

- Brutally **quick** → benefitted from decades of hardware advancement

- Brutally **textual** + **recursive** → UNIX is made of text & recursive process trees

### Tech Stack

- bash, awk, jq, etc. : **mostest high level** languages

- make : recursive macros, embarrassingly **parallel**, **incremental** builds

- m4 : POSIX templating (no built-in loops, only recursion)

- rsync : timestamps based delta → `make` : timestamp based delta

### High Level Language

What is the building block?

#### Haskell?

Functions

```haskell
functions . pointfree . compose
```

#### Bash

Programs

```bash
program | program | program
```

### Isn't Bash unmainainable?

Litmus test: Are you able to write a recursive HTTP server in bash?

- Yes → `continue`

- No → [checkout my talk](https://github.com/ms-jpq/defcon604-2023/tree/main)

## Idempotent deployments + rollback

Pretend we have an immutable server, except for `/usr/local/*`

### Configuration → Behavior

Where do service configurations live? → `/etc/*`

- UNIX `HIER` → Override `/etc/*` via `/usr/local/*` where possible

- `systemd` bind mount `/usr/local/*` into `/etc/*` where needed (`systemd` conf also under `/usr/local/*`)

Hard reset: `rm -fr -- /usr/local/*`

## Everything everywhere, at once

- Incremental & Parallel

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
