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
$jobs = Get-ChildItem -Recurse -LiteralPath $root -File -Filter 'docker-compose.yml' | ForEach-Object {
    $script = {
        $prefix = @('compose', '--progress', 'plain', '--file') + $args
        $postfix = if ($using:up) {
            @('up', '--detach', '--remove-orphans')
        }
        else {
            @('down', '--volumes')
        }
        $argv = $prefix + $postfix

        Write-Host -- '>>' docker $argv
        & docker $argv
        Write-Host -- '<<' docker $argv
    }

    Start-Job -ScriptBlock $script -ArgumentList $_.FullName
}

Wait-Job -Job $jobs
Receive-Job -Job $jobs
