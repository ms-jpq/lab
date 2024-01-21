# Windows

## Install

`Shift + F10` → console

### Network ByPass

```bash
oobe\bypassnro
```

## Defrag + Trim

```bash
defrag /help

# AUTO
# defrag.exe /PrintProgress /Optimize             C:

defrag.exe /PrintProgress /Defrag               C:
defrag.exe /PrintProgress /BootOptimize         C:
defrag.exe /PrintProgress /SlabConsolidate      C:
defrag.exe /PrintProgress /FreespaceConsolidate C:

defrag.exe /PrintProgress /Retrim               C:
```
