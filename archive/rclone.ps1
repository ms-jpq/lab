#!/usr/bin/env -S -- pwsh -NoProfile -NonInteractive

Set-StrictMode -Version 'Latest'
$ErrorActionPreference = 'Stop'
$PSStyle.OutputRendering = 'PlainText'
$PSNativeCommandUseErrorActionPreference = $true

Set-Location -- $PSScriptRoot

$uri = 'http://freenas.enp2s0.pfsense.home.arpa:8080'
$vol = 'rclone'
$cache = 'D:\rclone.cache'
$argv = @(
    '--config=NUL'
    '--dir-cache-time=1s'
    '--network-mode'
    '--no-modtime',
    "--cache-dir=$cache"
    '--vfs-cache-mode=full'
    "--http-url=$uri"
    "--volname=$vol"
    'mount'
    '--'
    ':http:/share/'
    '*'
)

rclone @argv
