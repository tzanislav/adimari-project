#requires -Version 5.1
<#
.SYNOPSIS
Previews or installs a staged Adimari NAS Connector update on the connector PC.

.DESCRIPTION
Run this script in an elevated PowerShell session on the Windows PC hosting
the connector. It invokes the guarded connector installer copied into the
staging directory. Preview mode is the default; pass -Apply to stop, swap, and
restart the Windows service.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$ReleaseDirectory = 'C:\staging\connector-release',

    [Parameter()]
    [ValidateRange(1, 2)]
    [int]$KeepPreviousPackages = 2,

    [Parameter()]
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installerPath = Join-Path $ReleaseDirectory 'Install-AdimariNasConnector.ps1'
$servicePublishDirectory = Join-Path $ReleaseDirectory 'service'
$controlCenterPublishDirectory = Join-Path $ReleaseDirectory 'control-center'

foreach ($requiredPath in @($installerPath, $servicePublishDirectory, $controlCenterPublishDirectory)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required connector release path was not found: $requiredPath"
    }
}

$installerArguments = @{
    ServicePublishDirectory = $servicePublishDirectory
    ControlCenterPublishDirectory = $controlCenterPublishDirectory
    KeepPreviousPackages = $KeepPreviousPackages
    Start = $true
}

if (-not $Apply) {
    $installerArguments.WhatIf = $true
    Write-Host 'Preview only: no connector files or services will be changed. Rerun with -Apply to install the update.'
}

& $installerPath @installerArguments
