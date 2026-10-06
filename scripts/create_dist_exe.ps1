<#
.SYNOPSIS
Builds an unsigned Windows installer, dist\Ito-<version>.exe, on this machine.

.DESCRIPTION
Builds the Rust helpers with MSVC, compiles the app and packages it with
electron-builder. Needs no Docker or bash.

The installer includes a default server URL, which users can change in
Settings > Server. The API key is left out unless -EmbedApiKey is given, so
users enter it once in Settings > Server.

The version comes from package.json; bump it there before building a release.

.PARAMETER ServerUrl
Default server URL to build in. Defaults to VITE_ITO_API_BASE_URL from the
environment or .env.

.PARAMETER NoServerUrl
Build without a default server URL; users enter it in Settings > Server.

.PARAMETER EmbedApiKey
Build in VITE_ITO_API_KEY from the environment or .env. Anyone who has the
installer can extract it.

.PARAMETER SkipNativeBuild
Reuse the existing binaries in native\target\x86_64-pc-windows-msvc\release.

.EXAMPLE
bun run build:win:local

.EXAMPLE
bun run build:win:local -ServerUrl https://ito.example.com -SkipNativeBuild
#>
[CmdletBinding()]
param(
    [string]$ServerUrl,
    [switch]$NoServerUrl,
    [switch]$EmbedApiKey,
    [switch]$SkipNativeBuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$NativeRelease = Join-Path $Root 'native\target\x86_64-pc-windows-msvc\release'
# Keep in sync with nativeBinaries in electron-builder.config.js.
$NativeBinaries = @(
    'global-key-listener',
    'audio-recorder',
    'text-writer',
    'active-application',
    'selected-text-reader'
)
# Set for the build only; restored afterwards so the calling shell is unchanged.
$BuildEnvNames = @(
    'VITE_ITO_APP_ENV',
    'VITE_ITO_APP_VERSION',
    'VITE_ITO_API_BASE_URL',
    'VITE_ITO_API_KEY',
    'CSC_IDENTITY_AUTO_DISCOVERY',
    'PNPM_HOME'
)

function Write-Step($Message) {
    Write-Host "`n==> $Message" -ForegroundColor Green
}

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "'$Command $($Arguments -join ' ')' failed with exit code $LASTEXITCODE"
    }
}

# Resolves a VITE_* value the way electron-vite does for a production build:
# the process environment wins, then the last match in these .env files.
function Get-BuildValue([string]$Name) {
    $fromEnv = [Environment]::GetEnvironmentVariable($Name)
    if ($fromEnv) { return $fromEnv.Trim() }
    $value = ''
    foreach ($file in '.env', '.env.local', '.env.production', '.env.production.local') {
        $path = Join-Path $Root $file
        if (-not (Test-Path $path)) { continue }
        foreach ($line in Get-Content $path) {
            if ($line -match "^\s*(?:export\s+)?$Name\s*=\s*(.*)$") {
                $raw = $Matches[1]
                if ($raw -match '^([''"`])(.*?)\1') { $value = $Matches[2] }
                else { $value = $raw -replace '\s+#.*$', '' }
                $value = $value.Trim()
            }
        }
    }
    return $value
}

# Helpers left running by earlier dev sessions lock their .exe files, which
# makes cargo fail with "Access is denied". The installed app is not affected.
function Stop-DevNativeHelpers {
    Get-Process -Name $NativeBinaries -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Path -and $_.Path.StartsWith($NativeRelease, [StringComparison]::OrdinalIgnoreCase)
        } |
        ForEach-Object {
            Write-Host "Stopping leftover dev helper $($_.Name) (PID $($_.Id))"
            Stop-Process -Id $_.Id -Force
        }
}

# electron-builder 26 downloads winCodeSign-2.6.0 and extracts it itself, but the
# archive contains macOS symlinks that Windows only lets administrators or
# Developer Mode create. Extract it once without the macOS folder instead;
# electron-builder then reuses the cached copy.
function Initialize-WinCodeSignCache {
    $cacheRoot = $env:ELECTRON_BUILDER_CACHE
    if (-not $cacheRoot) { $cacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache' }
    $target = Join-Path $cacheRoot 'winCodeSign\winCodeSign-2.6.0'
    if (Test-Path $target) { return }

    Write-Step 'Preparing the electron-builder winCodeSign cache (one-time)'
    $archive = Join-Path ([IO.Path]::GetTempPath()) 'winCodeSign-2.6.0.7z'
    $partial = "$target.partial"
    Invoke-Checked curl.exe @(
        '-fsSL', '-o', $archive,
        'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z'
    )
    if (Test-Path $partial) { Remove-Item $partial -Recurse -Force }
    $sevenZip = Join-Path $Root 'node_modules\7zip-bin\win\x64\7za.exe'
    Invoke-Checked $sevenZip @('x', '-bd', '-y', $archive, "-o$partial", '-xr!darwin') | Out-Null
    Rename-Item $partial (Split-Path -Leaf $target)
    Remove-Item $archive
}

$savedEnv = @{}
foreach ($name in $BuildEnvNames) {
    $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name)
}

Push-Location $Root
try {
    if (-not (Test-Path 'node_modules\electron-builder')) {
        throw 'Dependencies are missing. Run bun install first.'
    }
    if (-not $SkipNativeBuild -and -not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw 'cargo not found. Install Rust (see docs/WIN_INSTALL.md) or use -SkipNativeBuild.'
    }

    $version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
    if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
        throw "Invalid version in package.json: $version"
    }

    if ($NoServerUrl -and $ServerUrl) {
        throw 'Use either -ServerUrl or -NoServerUrl, not both.'
    }
    if ($NoServerUrl) {
        $ServerUrl = ''
    }
    elseif (-not $ServerUrl) {
        $ServerUrl = Get-BuildValue 'VITE_ITO_API_BASE_URL'
    }
    $ServerUrl = "$ServerUrl".Trim().TrimEnd('/')
    if ($ServerUrl -and $ServerUrl -notmatch '^https?://[^\s/?#@]+(/[^\s?#]*)?$') {
        throw "Invalid server URL: $ServerUrl (expected http:// or https://, no query or credentials)"
    }

    $apiKey = Get-BuildValue 'VITE_ITO_API_KEY'
    if ($EmbedApiKey -and -not $apiKey) {
        throw '-EmbedApiKey was given, but VITE_ITO_API_KEY is not set in the environment or .env.'
    }
    if (Get-BuildValue 'VITE_ITO_PLATFORM_OVERRIDE') {
        throw 'VITE_ITO_PLATFORM_OVERRIDE is set in the environment or .env. Remove it; it would break the installed app.'
    }
    $updaterBucket = Get-BuildValue 'VITE_ITO_UPDATER_BUCKET'

    if (-not $SkipNativeBuild) {
        Write-Step 'Building native helpers (x86_64-pc-windows-msvc, release)'
        Stop-DevNativeHelpers
        # Plain cargo keeps your normal Cargo config, such as registry mirrors and
        # proxy tokens. build-binaries.ps1 moves CARGO_HOME into native\.cargo-home.
        Push-Location 'native'
        try {
            Invoke-Checked cargo @('build', '--release', '--target', 'x86_64-pc-windows-msvc')
        }
        finally {
            Pop-Location
        }
    }
    foreach ($binary in $NativeBinaries) {
        $path = Join-Path $NativeRelease "$binary.exe"
        if (-not (Test-Path $path)) {
            throw "Missing native binary: $path. Run again without -SkipNativeBuild."
        }
    }

    Write-Step "Compiling Ito $version"
    $env:VITE_ITO_APP_ENV = 'prod'
    $env:VITE_ITO_APP_VERSION = $version
    # A single space overrides any .env value and the app trims it to "not set".
    # PowerShell deletes a variable set to '', which would let .env apply again.
    $env:VITE_ITO_API_BASE_URL = if ($ServerUrl) { $ServerUrl } else { ' ' }
    $env:VITE_ITO_API_KEY = if ($EmbedApiKey) { $apiKey } else { ' ' }
    Invoke-Checked bun @('run', 'electron-vite', 'build')

    if (-not $EmbedApiKey -and $apiKey) {
        $leak = Get-ChildItem 'out' -Recurse -File |
            Select-String -SimpleMatch -Pattern $apiKey -List |
            Select-Object -First 1
        if ($leak) {
            throw "The API key from .env ended up in $($leak.Path). Not packaging."
        }
    }

    Write-Step 'Packaging the installer'
    Initialize-WinCodeSignCache
    $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    # electron-builder picks its package manager from the environment, and
    # PNPM_HOME makes it call pnpm, which refuses to run in this project.
    Remove-Item Env:PNPM_HOME -ErrorAction SilentlyContinue
    Invoke-Checked bunx @(
        'electron-builder', '--config', 'electron-builder.config.js',
        '--win', '--x64', '--publish=never'
    )

    $installer = Join-Path $Root "dist\Ito-$version.exe"
    if (-not (Test-Path $installer)) {
        throw "Installer not found: $installer"
    }
    $sizeMb = [Math]::Round((Get-Item $installer).Length / 1MB)
    $urlNote = if ($ServerUrl) { "$ServerUrl (users can change it in Settings > Server)" } else { 'not set; enter it in Settings > Server' }
    $keyNote = if ($EmbedApiKey) { 'included (extractable from the installer)' } else { 'not included; enter it in Settings > Server' }
    $updateNote = if ($updaterBucket) { "from S3 bucket $updaterBucket" } else { 'off' }

    Write-Step 'Done'
    Write-Host "Installer:    $installer ($sizeMb MB)"
    Write-Host "Version:      $version"
    Write-Host "Server URL:   $urlNote"
    Write-Host "API key:      $keyNote"
    Write-Host "Auto-updates: $updateNote"
}
finally {
    foreach ($name in $BuildEnvNames) {
        [Environment]::SetEnvironmentVariable($name, $savedEnv[$name])
    }
    Pop-Location
}
