#!/usr/bin/env -S -- powershell.exe -NoProfile -NonInteractive

Set-StrictMode -Version 'Latest'
$ErrorActionPreference = 'Stop'

Set-Location -- $PSScriptRoot

$remote = 'http://freenas.enp2s0.pfsense.home.arpa:8080'
$vol = 'freenas'
$cache = 'D:\rclone.cache'
$argv = @(
    '--config=NUL'
    '--dir-cache-time=9s'
    '--network-mode'
    '--read-only'
    "--cache-dir=$cache"
    '--vfs-cache-mode=full'
    '--webdav-vendor=rclone',
    '--webdav-pacer-min-sleep=0',
    "--http-url=$remote"
    "--volname=$vol"
    'mount'
    '--'
    ':http:/webdav/rw/'
    '*'
)
# READ ONLY doesn't work LMAO
rclone @argv
