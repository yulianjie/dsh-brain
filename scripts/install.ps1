# Copyright 2026 DSH Brain contributors
# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$Profile = 'desktop',
    [string]$DshCli = (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
    [string]$PackagePath,
    [string]$DshHome,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
if ($Profile -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]*$') { throw 'Profile must contain only letters, digits, underscores, or hyphens.' }
if (-not (Test-Path -LiteralPath $DshCli -PathType Leaf)) { throw "Desktop bundled CLI not found: $DshCli. Supply -DshCli explicitly for another installation." }
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($PackagePath) {
    $PackagePath = (Resolve-Path -LiteralPath $PackagePath).Path
    if ([IO.Path]::GetExtension($PackagePath) -ne '.tgz') { throw 'PackagePath must be a packaged npm .tgz file.' }
}
if ($DryRun) {
    [pscustomobject]@{ cli = $DshCli; profile = $Profile; home = $DshHome; action = 'plugin add'; package = $(if ($PackagePath) { $PackagePath } else { '(npm pack from project root)' }) } | ConvertTo-Json
    return
}
if (-not $PackagePath) {
    Push-Location -LiteralPath $projectRoot
    try {
        $packOutput = & npm.cmd pack --json
        if ($LASTEXITCODE -ne 0) { throw "npm pack failed with exit code $LASTEXITCODE" }
        $pack = ($packOutput -join "`n") | ConvertFrom-Json
        $PackagePath = Join-Path $projectRoot $pack[0].filename
    } finally { Pop-Location }
}
$previousHome = $env:DSH_HOME
try {
    if ($DshHome) { $env:DSH_HOME = [IO.Path]::GetFullPath($DshHome) }
    & $DshCli plugin --profile $Profile add $PackagePath
    if ($LASTEXITCODE -ne 0) { throw "DSH plugin installation failed with exit code $LASTEXITCODE" }
} finally { $env:DSH_HOME = $previousHome }
Write-Host "Installed dsh-brain in profile '$Profile'. Restart that profile to load the plugin."
