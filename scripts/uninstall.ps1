# Copyright 2026 DSH Brain contributors
# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$Profile = 'desktop',
    [string]$DshCli = (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
    [string]$DshHome,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
if ($Profile -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]*$') { throw 'Profile must contain only letters, digits, underscores, or hyphens.' }
if (-not (Test-Path -LiteralPath $DshCli -PathType Leaf)) { throw "Desktop bundled CLI not found: $DshCli. Supply -DshCli explicitly for another installation." }
if ($DryRun) {
    [pscustomobject]@{ cli = $DshCli; profile = $Profile; home = $DshHome; action = 'plugin remove'; package = '@yulianjie/dsh-brain' } | ConvertTo-Json
    return
}
$previousHome = $env:DSH_HOME
try {
    if ($DshHome) { $env:DSH_HOME = [IO.Path]::GetFullPath($DshHome) }
    & $DshCli plugin --profile $Profile remove '@yulianjie/dsh-brain'
    if ($LASTEXITCODE -ne 0) { throw "DSH plugin removal failed with exit code $LASTEXITCODE" }
} finally { $env:DSH_HOME = $previousHome }
Write-Host "Removed dsh-brain from profile '$Profile'. Restart that profile. Local brain data is retained."
