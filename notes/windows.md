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

contig.exe -s -v C:\*

# AUTO
# defrag.exe /Verbose /PrintProgress /NormalPriority /Optimize             C:

defrag.exe /Verbose /PrintProgress /NormalPriority /Defrag               C:
defrag.exe /Verbose /PrintProgress /NormalPriority /BootOptimize         C:
defrag.exe /Verbose /PrintProgress /NormalPriority /SlabConsolidate      C:
defrag.exe /Verbose /PrintProgress /NormalPriority /FreespaceConsolidate C:

defrag.exe /Verbose /PrintProgress /NormalPriority /Retrim               C:
```
