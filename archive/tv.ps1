#!/usr/bin/env -S -- pwsh -NoProfile -NonInteractive

Set-StrictMode -Version 'Latest'
$ErrorActionPreference = 'Stop'
$PSStyle.OutputRendering = 'PlainText'


$sch_ns = "\scripts-open-browser\"
$uri = "$input"
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($uri))
$pwsh = @"
Start-Process -- ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("$encoded")))
"@
$argv = @(
    '-NoProfile'
    '-NonInteractive'
    '-WindowStyle', 'Hidden'
    '-EncodedCommand', [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($pwsh))
)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($argv | Join-String -Separator ' ')

Register-ScheduledTask -TaskPath $sch_ns -TaskName (New-Guid) -Force -Action $action | Start-ScheduledTask
Unregister-ScheduledTask -Confirm:$false -TaskPath $sch_ns

$uri
