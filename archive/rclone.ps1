#!/usr/bin/env -S -- pwsh -NoProfile -NonInteractive

Set-StrictMode -Version 'Latest'
$ErrorActionPreference = 'Stop'
$PSStyle.OutputRendering = 'PlainText'
$PSNativeCommandUseErrorActionPreference = $true

Set-Location -- $PSScriptRoot

rclone --config=NUL --dir-cache-time=0 --smb-host freenas.enp2s0.pfsense.home.arpa mount -- :smb:/ R:
