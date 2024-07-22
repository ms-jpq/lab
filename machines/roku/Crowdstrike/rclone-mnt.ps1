#!/usr/bin/env -S -- pwsh -NoProfile -NonInteractive

Set-StrictMode -Version 'Latest'
$ErrorActionPreference = 'Stop'
$PSStyle.OutputRendering = 'PlainText'
$PSNativeCommandUseErrorActionPreference = $true

Set-Location -- $PSScriptRoot

$remote = 'http://freenas.enp2s0.pfsense.home.arpa:8080'
$vol = 'freenas'
$cache = 'D:\rclone.cache'
$argv = @(
    '--config=NUL'
    '--dir-cache-time=9s'
    '--network-mode'
    '--read-only'
    '--no-modtime',
    "--cache-dir=$cache"
    '--vfs-cache-mode=full'
    "--webdav-vendor=rclone",
    "--http-url=$remote"
    "--volname=$vol"
    'mount'
    '--'
    ':http:/webdav/rw'
    '*'
)
# READ ONLY doesn't work LMAO
rclone @argv
