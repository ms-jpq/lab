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

defrag /MultiThread /BootOptimize         C: && defrag /TrackProgress C:
defrag /MultiThread /Defrag               C: && defrag /TrackProgress C:
defrag /MultiThread /FreespaceConsolidate C: && defrag /TrackProgress C:
defrag /MultiThread /Optimize             C: && defrag /TrackProgress C:
defrag /MultiThread /Retrim               C: && defrag /TrackProgress C:
defrag /MultiThread /SlabConsolidate      C: && defrag /TrackProgress C:
```
