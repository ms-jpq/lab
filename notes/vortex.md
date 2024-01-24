# Vortex Mods

```bash
Set-Location -- '...'
jq --raw-output '.files[].relPath' '.\vortex.deployment.json' | Remove-Item -Force
```
