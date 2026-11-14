<#
.SYNOPSIS
    Builds HarmOS-0.1.0-x86_64.ova on a Windows 10 x64 host using Packer + Oracle VirtualBox.

.DESCRIPTION
    Validates every dependency BEFORE starting a 45-minute build, stages the runtime
    payload, runs Packer, then verifies and checksums the exported appliance.
    All paths are quoted so directories containing spaces (e.g. C:\Users\Jo Smith\HarmOS)
    work correctly.

    STATUS: written and syntax-reviewed, NOT executed in the authoring sandbox
    (no Windows host and no VirtualBox available there). Run it yourself with:

        powershell -ExecutionPolicy Bypass -File .\packaging\windows\Build-HarmOS.ps1 `
            -IsoPath 'D:\iso\ubuntu-24.04.3-live-server-amd64.iso' `
            -IsoChecksum 'sha256:<paste from Ubuntu SHA256SUMS>'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $IsoChecksum,
    [string] $IsoPath,
    [string] $Version  = '0.1.0-alpha',
    [int]    $Memory   = 8192,
    [int]    $Cpus     = 4,
    [int]    $DiskMb   = 61440,
    [switch] $SkipPayload
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PackerDir  = Join-Path $RepoRoot 'packaging\packer'
$PayloadDir = Join-Path $RepoRoot 'payload'
$DistDir    = Join-Path $RepoRoot 'dist\ova'

function Write-Step   { param($m) Write-Host "[harmos] $m" -ForegroundColor Cyan }
function Write-Ok     { param($m) Write-Host "[  ok  ] $m" -ForegroundColor Green }
function Fail {
    param($Message, $Remedy)
    Write-Host "[ fail ] $Message" -ForegroundColor Red
    if ($Remedy) { Write-Host "         -> $Remedy" -ForegroundColor Yellow }
    exit 1
}

# ---------------------------------------------------------------- dependencies
Write-Step 'Validating host dependencies'

if ([Environment]::Is64BitOperatingSystem -ne $true) {
    Fail 'HarmOS requires a 64-bit Windows host.' 'x86_64 guests cannot run on a 32-bit host OS.'
}

$vbox = Get-Command 'VBoxManage.exe' -ErrorAction SilentlyContinue
if (-not $vbox) {
    $guess = Join-Path ${env:ProgramFiles} 'Oracle\VirtualBox\VBoxManage.exe'
    if (Test-Path -LiteralPath $guess) {
        $env:Path = "$env:Path;" + (Split-Path -Parent $guess)
        $vbox = Get-Command 'VBoxManage.exe' -ErrorAction SilentlyContinue
    }
}
if (-not $vbox) {
    Fail 'VBoxManage.exe not found.' 'Install Oracle VirtualBox 7.x from https://www.virtualbox.org/ and reopen PowerShell.'
}
$vboxVersion = (& $vbox.Source --version) -join ''
Write-Ok "VirtualBox $vboxVersion"

if (-not (Get-Command 'packer.exe' -ErrorAction SilentlyContinue)) {
    Fail 'packer.exe not found.' 'Install with:  winget install HashiCorp.Packer   (then reopen PowerShell).'
}
Write-Ok "Packer $((& packer.exe --version) -join '')"

# Hyper-V / WSL2 / Memory Integrity steal VT-x from VirtualBox and produce the
# infamous "VERR_VMX_NO_VMX" failure mid-build. Warn loudly, up front.
$hyperv = Get-WindowsOptionalFeature -Online -FeatureName 'Microsoft-Hyper-V-Hypervisor' -ErrorAction SilentlyContinue
if ($hyperv -and $hyperv.State -eq 'Enabled') {
    Write-Host '[ warn ] Hyper-V is enabled. VirtualBox 7 can run nested, but AI workloads will be slow' -ForegroundColor Yellow
    Write-Host '         and some hosts fail with VERR_VMX_NO_VMX. To disable:' -ForegroundColor Yellow
    Write-Host '           bcdedit /set hypervisorlaunchtype off   (then reboot)' -ForegroundColor Yellow
}

$freeGb = [math]::Round((Get-PSDrive -Name ($RepoRoot.Substring(0,1))).Free / 1GB, 1)
if ($freeGb -lt 40) { Fail "Only $freeGb GB free on drive $($RepoRoot.Substring(0,1)):." 'The build needs ~40 GB of scratch space.' }
Write-Ok "$freeGb GB free disk"

$hostRamGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
if (($Memory / 1024) -gt ($hostRamGb - 4)) {
    Write-Host "[ warn ] Guest RAM ${Memory}MB on a ${hostRamGb}GB host leaves little for Windows. Consider -Memory 4096." -ForegroundColor Yellow
}
Write-Ok "Host RAM ${hostRamGb} GB"

# ------------------------------------------------------------------- payload
if (-not $SkipPayload) {
    Write-Step 'Staging HarmOS runtime payload'
    if (Test-Path -LiteralPath $PayloadDir) { Remove-Item -LiteralPath $PayloadDir -Recurse -Force }
    New-Item -ItemType Directory -Path $PayloadDir -Force | Out-Null
    $include = @('sidecar','shared','frontend','harmos','os','docs','package.json','package-lock.json','LICENSE','NOTICE.md')
    foreach ($item in $include) {
        $src = Join-Path $RepoRoot $item
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination $PayloadDir -Recurse -Force
        } else {
            Write-Host "[ warn ] payload item missing, skipped: $item" -ForegroundColor Yellow
        }
    }
    # Never ship build-host state into the appliance.
    foreach ($junk in @('node_modules','.git','.env','dist','payload')) {
        Get-ChildItem -LiteralPath $PayloadDir -Recurse -Force -Filter $junk -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    }
    Write-Ok "Payload staged at $PayloadDir"
}

# --------------------------------------------------------------------- build
New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
if (Test-Path -LiteralPath (Join-Path $DistDir "HarmOS-$Version-x86_64.ova")) {
    Fail "An OVA for $Version already exists in $DistDir." 'Delete or move it first — Packer refuses to overwrite.'
}

Push-Location -LiteralPath $PackerDir
try {
    Write-Step 'packer init'
    & packer.exe init '.'
    if ($LASTEXITCODE -ne 0) { Fail 'packer init failed.' 'Check your network/proxy; the VirtualBox plugin is downloaded from GitHub.' }

    Write-Step 'packer validate'
    & packer.exe validate -var "iso_checksum=$IsoChecksum" -var "version=$Version" '.'
    if ($LASTEXITCODE -ne 0) { Fail 'packer validate failed.' 'Fix the template errors reported above before building.' }

    Write-Step "packer build (expect 30-60 minutes)"
    $buildArgs = @('build', '-var', "iso_checksum=$IsoChecksum", '-var', "version=$Version",
                   '-var', "guest_ram=$Memory", '-var', "guest_cpus=$Cpus", '-var', "disk_mb=$DiskMb")
    if ($IsoPath) { $buildArgs += @('-var', "iso_url=$IsoPath") }
    $buildArgs += '.'
    & packer.exe @buildArgs
    if ($LASTEXITCODE -ne 0) { Fail 'packer build failed.' 'Read packer.log above. Common causes: wrong ISO checksum, Hyper-V holding VT-x, autoinstall timeout.' }
}
finally { Pop-Location }

# -------------------------------------------------------------------- verify
$ova = Join-Path $DistDir "HarmOS-$Version-x86_64.ova"
if (-not (Test-Path -LiteralPath $ova)) { Fail 'Build reported success but no .ova was produced.' 'Inspect dist\ova\ and the Packer output.' }

Write-Step 'Verifying exported appliance'
& $vbox.Source import "$ova" --dry-run | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'VBoxManage could not read the exported OVA.' 'The export is corrupt; re-run the build.' }

$hash = (Get-FileHash -LiteralPath $ova -Algorithm SHA256).Hash.ToLower()
"$hash  $(Split-Path -Leaf $ova)" | Set-Content -LiteralPath "$ova.sha256" -Encoding ascii
$sizeGb = [math]::Round((Get-Item -LiteralPath $ova).Length / 1GB, 2)

Write-Ok "HarmOS $Version built"
Write-Host ""
Write-Host "  Appliance : $ova"  -ForegroundColor White
Write-Host "  Size      : $sizeGb GB" -ForegroundColor White
Write-Host "  SHA-256   : $hash" -ForegroundColor White
Write-Host ""
Write-Host "  Import it with:  .\packaging\windows\Import-HarmOS.ps1 -OvaPath '$ova'" -ForegroundColor Cyan
