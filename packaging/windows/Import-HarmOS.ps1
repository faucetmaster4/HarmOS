<#
.SYNOPSIS
    Imports HarmOS into Oracle VirtualBox on Windows 10 and applies safe defaults (NAT only).
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\Import-HarmOS.ps1 -OvaPath 'C:\Users\Jo Smith\Downloads\HarmOS-0.1.0-x86_64.ova'
.NOTES
    STATUS: written, not executed in the authoring sandbox (no Windows host / VirtualBox).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $OvaPath,
    [string] $VmName        = 'HarmOS',
    [int]    $Memory        = 8192,
    [int]    $Cpus          = 4,
    [string] $ExpectedSha256,
    [switch] $Start
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail { param($m,$r) Write-Host "[ fail ] $m" -ForegroundColor Red; if($r){Write-Host "         -> $r" -ForegroundColor Yellow}; exit 1 }
function Ok   { param($m) Write-Host "[  ok  ] $m" -ForegroundColor Green }

$vbox = Get-Command 'VBoxManage.exe' -ErrorAction SilentlyContinue
if (-not $vbox) {
    $guess = Join-Path ${env:ProgramFiles} 'Oracle\VirtualBox\VBoxManage.exe'
    if (Test-Path -LiteralPath $guess) { $vbox = Get-Item -LiteralPath $guess }
}
if (-not $vbox) { Fail 'VBoxManage.exe not found.' 'Install Oracle VirtualBox 7.x, then reopen PowerShell.' }
$vboxExe = $vbox.Source ?? $vbox.FullName

if (-not (Test-Path -LiteralPath $OvaPath)) { Fail "OVA not found: $OvaPath" 'Check the path (quote it if it contains spaces).' }

if ($ExpectedSha256) {
    Write-Host '[harmos] verifying checksum...' -ForegroundColor Cyan
    $actual = (Get-FileHash -LiteralPath $OvaPath -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $ExpectedSha256.ToLower().Replace('sha256:','')) {
        Fail "Checksum mismatch. Expected $ExpectedSha256, got $actual." 'Do not import this file. Re-download it.'
    }
    Ok 'SHA-256 verified'
}

$existing = & $vboxExe list vms | Select-String -SimpleMatch "`"$VmName`""
if ($existing) { Fail "A VM named '$VmName' already exists." "Remove it (VBoxManage unregistervm `"$VmName`" --delete) or pass -VmName <other>." }

Write-Host '[harmos] importing appliance (several minutes)...' -ForegroundColor Cyan
& $vboxExe import "$OvaPath" --vsys 0 --vmname "$VmName" --cpus $Cpus --memory $Memory
if ($LASTEXITCODE -ne 0) { Fail 'Import failed.' 'Check free disk space and that the OVA is not partially downloaded.' }
Ok "Imported as '$VmName'"

Write-Host '[harmos] applying safe defaults...' -ForegroundColor Cyan
& $vboxExe modifyvm "$VmName" --nic1 nat                 # never bridged by default
& $vboxExe modifyvm "$VmName" --vrde off                 # no remote display
& $vboxExe modifyvm "$VmName" --clipboard-mode bidirectional
& $vboxExe modifyvm "$VmName" --draganddrop disabled
& $vboxExe modifyvm "$VmName" --graphicscontroller vmsvga --vram 128
& $vboxExe modifyvm "$VmName" --audio-driver none
& $vboxExe modifyvm "$VmName" --nestedpaging on --paravirtprovider kvm
# No shared folders are configured. Host-guest sharing is opt-in:
#   VBoxManage sharedfolder add "HarmOS" --name host-share --hostpath "C:\path" --readonly --automount
Ok 'NAT networking, no remote display, no shared folders, no host drag-and-drop'

if ($Start) {
    & $vboxExe startvm "$VmName" --type gui
    Ok 'VM started — first boot runs harmos-firstboot and then AetherFrame'
} else {
    Write-Host ""
    Write-Host "  Start it with:  VBoxManage startvm `"$VmName`" --type gui" -ForegroundColor Cyan
    Write-Host "  First login  :  user 'harmos' — you will be forced to set a new password." -ForegroundColor Cyan
}
