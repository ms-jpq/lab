#!/usr/bin/env -S -- powershell.exe -NoProfile -NonInteractive

Set-StrictMode -Version 'Latest'
$ErrorActionPreference = 'Stop'

Set-Location -- $PSScriptRoot

$remote = 'http://freenas.enp2s0.pfsense.home.arpa:8080'
$vol = 'freenas'
$cache = 'D:\rclone.cache'
$argv = @(
    "--cache-dir=$cache"
    "--http-url=$remote"
    "--volname=$vol"
    '--config=NUL'
    '--dir-cache-time=10s'
    '--network-mode'
    '--poll-interval=88s'
    '--read-only'
    '--transfers=8'
    '--use-mmap',
    '--vfs-refresh',
    '--vfs-fast-fingerprint',
    '--vfs-cache-mode=full'
    '--webdav-pacer-min-sleep=0',
    '--webdav-vendor=nginx',
    'mount'
    '--'
    ':http:/webdav/'
    '*'
)
# READ ONLY doesn't work LMAO
rclone @argv
