#!/usr/bin/env -S -- pwsh -NoProfile -NonInteractive

param (
    [switch] $up = $(throw)
)

Set-StrictMode -Version 'Latest'
$PSStyle.OutputRendering = 'PlainText'
$ProgressPreference = 'SilentlyContinue'
$PSNativeCommandUseErrorActionPreference = $true

# $ErrorActionPreference = 'Stop'


$network = 'traefik'
$net = docker network ls --format 'json' | ConvertFrom-Json | Where-Object { $_.Name -eq $network }
if (-not $net) {
    docker network create --internal -- $network
}


$root = Join-Path -Path $PSScriptRoot 'Compose'

Get-ChildItem -Recurse -LiteralPath $root -File -Filter 'docker-compose.yml' | ForEach-Object -Parallel {
    $prefix = @('compose', '--progress', 'plain', '--file', $_.FullName)
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

