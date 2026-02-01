[CmdletBinding()]
param(
    [switch]$Mac,
    [switch]$Windows,
    [switch]$All,
    [switch]$X64
)

$ErrorActionPreference = "Stop"

function Write-Status($Message) {
    Write-Host "==> $Message" -ForegroundColor Green
}

function Write-Info($Message) {
    Write-Host "--> $Message" -ForegroundColor Cyan
}

function Write-ErrorMsg($Message) {
    Write-Host "Error: $Message" -ForegroundColor Red
}

function Load-MsvcEnv {
    if ($env:MSVC_ENV_INITIALIZED) {
        return
    }

    if ($env:VCINSTALLDIR -and (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
        $env:MSVC_ENV_INITIALIZED = "true"
        return
    }

    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) {
        $vswhere = "${env:ProgramFiles}\Microsoft Visual Studio\Installer\vswhere.exe"
    }
    if (-not (Test-Path $vswhere)) {
        throw "vswhere.exe not found. Install Visual Studio Build Tools with the C++ workload."
    }

    $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $installPath) {
        throw "Visual Studio C++ Build Tools not found. Install the C++ build tools workload."
    }

    $vcvars = Join-Path $installPath "VC\Auxiliary\Build\vcvars64.bat"
    if (-not (Test-Path $vcvars)) {
        throw "vcvars64.bat not found at: $vcvars"
    }

    Write-Info "Loading MSVC build environment..."

    $envOutput = cmd.exe /c "call `"$vcvars`" >nul && set"
    foreach ($line in $envOutput) {
        $pair = $line -split "=", 2
        if ($pair.Length -ne 2) { continue }
        $key = $pair[0]
        $value = $pair[1]
        switch ($key) {
            "PATH" { $env:PATH = $value }
            "INCLUDE" { $env:INCLUDE = $value }
            "LIB" { $env:LIB = $value }
            "LIBPATH" { $env:LIBPATH = $value }
            "VCINSTALLDIR" { $env:VCINSTALLDIR = $value }
            "VSINSTALLDIR" { $env:VSINSTALLDIR = $value }
            "VSCMD_VER" { $env:VSCMD_VER = $value }
            "WindowsSdkDir" { $env:WindowsSdkDir = $value }
            "WindowsSdkVersion" { $env:WindowsSdkVersion = $value }
            "VCToolsInstallDir" { $env:VCToolsInstallDir = $value }
            "VCToolsVersion" { $env:VCToolsVersion = $value }
        }
    }

    $sdkLib = $null
    if ($env:WindowsSdkDir) {
        $sdkVersion = $env:WindowsSdkVersion
        if (-not $sdkVersion) {
            $sdkVersion = (Get-ChildItem -Path (Join-Path $env:WindowsSdkDir "Lib") -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending |
                Select-Object -First 1).Name
        }
        if ($sdkVersion) {
            $sdkLib = Join-Path $env:WindowsSdkDir "Lib\$sdkVersion\um\x64\kernel32.lib"
        }
    }

    if (-not $sdkLib -or -not (Test-Path $sdkLib)) {
        throw "Windows SDK not found or kernel32.lib missing. Install the Windows 10/11 SDK via Visual Studio Build Tools (Desktop development with C++)."
    }

    $env:MSVC_ENV_INITIALIZED = "true"
}

function Build-NativeWorkspace {
    Write-Status "Building native workspace..."

    $projectRoot = $PSScriptRoot
    if (-not $projectRoot) {
        $projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    $env:CARGO_HOME = Join-Path $projectRoot "native\.cargo-home"

    Push-Location (Join-Path $projectRoot "native")
    try {
        Write-Info "Installing dependencies for workspace..."
        cargo fetch
        if ($LASTEXITCODE -ne 0) {
            throw "cargo fetch failed with exit code $LASTEXITCODE"
        }

        if ($Windows) {
            Write-Info "Building Windows binary for entire workspace..."
            Load-MsvcEnv
            Write-Info "Building with MSVC toolchain on Windows..."
            cargo build --release --target x86_64-pc-windows-msvc
            if ($LASTEXITCODE -ne 0) {
                throw "cargo build failed with exit code $LASTEXITCODE"
            }
        }
    }
    finally {
        Pop-Location
    }
}

if (-not ($Mac -or $Windows -or $All)) {
    Write-ErrorMsg "No platform specified. Use -Mac, -Windows, or -All."
    Write-Host "Usage: .\build-binaries.ps1 [-Mac] [-Windows] [-All] [-X64]"
    exit 1
}

if ($All) {
    $Mac = $true
    $Windows = $true
}

if ($Mac) {
    if ($IsWindows) {
        throw "macOS builds are not supported on Windows."
    }
}

if ($Windows) {
    Write-Status "Adding Windows target..."
    Write-Info "Using MSVC toolchain on Windows for better antivirus compatibility"
    Load-MsvcEnv
    rustup target add x86_64-pc-windows-msvc
}

Build-NativeWorkspace

Write-Status "Native workspace build completed successfully!"
