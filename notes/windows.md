# Windows

## Install

`Shift + F10` → console

### Network ByPass

```bash
oobe\bypassnro
```

## Defrag + Trim

```bash
contig.exe -s -v C:\*
defrag.exe /Verbose /PrintProgress /NormalPriority /BootOptimize         C:
defrag.exe /Verbose /PrintProgress /NormalPriority /SlabConsolidate      C:
defrag.exe /Verbose /PrintProgress /NormalPriority /FreespaceConsolidate C:
defrag.exe /Verbose /PrintProgress /NormalPriority /Retrim               C:
```
