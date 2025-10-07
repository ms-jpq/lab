#!/usr/bin/env -S -- powershell.exe -NoProfile -NonInteractive

param (
    [switch] $up = $(throw)
)

Set-StrictMode -Version 'Latest'
$ErrorActionPreference = 'Stop'

$root = Join-Path -Path $PSScriptRoot 'Compose'
$stacks = Get-ChildItem -Recurse -LiteralPath $root -File -Filter 'docker-compose.yml'

$stacks | ForEach-Object -Parallel {
    $prefix = @('compose', '--progress', 'plain', '--file')
    $argv = if ($up) {
        @($_, 'up', '--detach', '--remove-orphans')
    }
    else {
        @($_, 'down', '--volumes')
    }

    & docker $prefix $argv
}
