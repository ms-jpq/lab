#!/usr/bin/env -S -- pwsh -NoProfile -NonInteractive

Set-StrictMode -Version 'Latest'
$ErrorActionPreference = 'Stop'
$PSStyle.OutputRendering = 'PlainText'


$dst = Join-Path -- $env:HOME 'Desktop'
$tmp = [IO.Directory]::CreateTempSubdirectory()
$zip = New-Object IO.Compression.ZipArchive([Console]::OpenStandardInput())

[IO.Compression.ZipFileExtensions]::ExtractToDirectory($zip, $tmp)
$items = Get-ChildItem -Recurse -Path $tmp | Move-Item -PassThru -Destination $dst
Remove-Item -Recurse -Force -Path $tmp

$items
