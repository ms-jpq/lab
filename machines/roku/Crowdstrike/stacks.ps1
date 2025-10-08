#!/usr/bin/env -S -- powershell.exe -NoProfile -NonInteractive

param (
    [switch] $up = $(throw)
)

Set-StrictMode -Version 'Latest'
$ErrorActionPreference = 'Stop'


$network = 'traefik'
$net = docker network ls --format 'json' | ConvertFrom-Json | Where-Object { $_.Name -eq $network }
if (-not $net) {
    docker network create --internal -- $network
}


$root = Join-Path -Path $PSScriptRoot 'Compose'
Get-ChildItem -Recurse -LiteralPath $root -File -Filter 'docker-compose.yml' | ForEach-Object {
    $prefix = @('compose', '--progress', 'plain', '--file', $_.FullName)
    $argv = if ($up) {
        @('up', '--detach', '--remove-orphans')
    }
    else {
        @('down', '--volumes')
    }

    Write-Host -- $_.FullName
    & docker $prefix $argv
}
