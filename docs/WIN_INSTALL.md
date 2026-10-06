# Windows Native Build Setup

This guide covers setting up a Windows development environment to build the Ito application natively (without Docker).

## Prerequisites

- Windows 10 version 1809 or later (Windows 11 recommended)
- Administrator access
- Internet connection

## Step 1: Install Git for Windows (includes Git Bash)

Git Bash provides a Unix-like terminal environment needed for running build scripts.

### Option A: Using winget (Recommended)

Open PowerShell as Administrator and run:

```powershell
winget install -e --id Git.Git
```

### Option B: Manual Download

1. Download from [gitforwindows.org](https://gitforwindows.org/)
2. Run the installer with default settings
3. Ensure "Git Bash Here" is selected during installation

### Verify Installation

Open a new terminal and run:

```bash
git --version
```

---

## Step 2: Install Visual Studio Build Tools

The MSVC toolchain is required for compiling native Rust components. Any recent version works (2022 or 2026).

### Option A: Using winget (Recommended)

```powershell
# Install the latest version (Visual Studio 2026)
winget install -e --id Microsoft.VisualStudio.2026.BuildTools
```

After installation, you need to add the C++ workload. Run the Visual Studio Installer and select "Desktop development with C++".

### Option B: Command-Line Installation (Full)

Download and run the bootstrapper with the C++ workload pre-selected:

```powershell
# Download the latest installer
Invoke-WebRequest -Uri "https://aka.ms/vs/18/release/vs_buildtools.exe" -OutFile "$env:TEMP\vs_buildtools.exe"

# Install with C++ workload
Start-Process -FilePath "$env:TEMP\vs_buildtools.exe" -ArgumentList "--add", "Microsoft.VisualStudio.Workload.VCTools", "--includeRecommended", "--passive", "--norestart", "--wait" -Wait
```

### Option C: Manual Download

1. Go to [Visual Studio Downloads](https://visualstudio.microsoft.com/downloads/)
2. Scroll to "Tools for Visual Studio" and download "Build Tools for Visual Studio 2026"
3. Run the installer
4. Select **"Desktop development with C++"** workload
5. Click Install

> **Note:** Visual Studio 2022 also works if you already have it installed. The codebase only requires the MSVC toolchain, not a specific VS version.

### Verify Installation

After installation, restart your terminal. The MSVC compiler should be available when Rust needs it.

### Visual Studio Community 2022 (GUI Install)

If you already have Visual Studio Community 2022:

1. Open Visual Studio Installer.
2. Modify “Visual Studio Community 2022”.
3. Install “Desktop development with C++” and ensure “Windows 10/11 SDK” is checked.

---

## Step 3: Install Rust

### Download and Install

1. Go to [rustup.rs](https://rustup.rs/)
2. Download and run `rustup-init.exe`
3. When prompted, select option 1 (default installation)
   - This automatically configures MSVC as the default toolchain on Windows

### Add Windows MSVC Target

Open a new Git Bash or PowerShell terminal and run:

```bash
rustup target add x86_64-pc-windows-msvc
```

### Verify Installation

```bash
rustc --version
cargo --version
rustup show
```

The output of `rustup show` should show `stable-x86_64-pc-windows-msvc` as the default toolchain.

---

## Step 4: Install Node.js

### Option A: Using winget (Recommended)

```powershell
winget install -e --id OpenJS.NodeJS.LTS
```

### Option B: Manual Download

1. Go to [nodejs.org](https://nodejs.org/)
2. Download the LTS version (.msi installer)
3. Run the installer with default settings

### Verify Installation

Open a new terminal and run:

```bash
node --version
npm --version
```

You should see Node.js 20.x or later.

---

## Step 5: Install Bun

Open PowerShell and run:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

### Verify Installation

Open a new Git Bash terminal and run:

```bash
bun --version
```

---

## Verification Checklist

Open Git Bash and run these commands to verify everything is installed:

```bash
# Git
git --version

# Rust
rustc --version
cargo --version
rustup target list --installed | grep msvc

# Node.js
node --version

# Bun
bun --version
```

Expected output (versions may vary):

```
git version 2.43.0.windows.1
rustc 1.75.0 (82e1608df 2023-12-21)
cargo 1.75.0 (1d8b05cdd 2023-11-20)
x86_64-pc-windows-msvc
v20.11.0
1.0.25
```

---

## Building the Application

Once all dependencies are installed, build the installer from PowerShell:

```powershell
# Clone the repository (if not already done)
git clone https://github.com/heyito/ito.git
cd ito

# Install JavaScript dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env to set VITE_ITO_API_BASE_URL to your remote server URL

# Build the native helpers, compile the app and create the installer
bun run build:win:local
```

The installer is created at `dist\Ito-<version>.exe`, and `dist\Ito-<version>.zip` contains a version that runs without installing. The script (`scripts/create_dist_exe.ps1`):

- Builds the Rust helpers with `cargo build --release --target x86_64-pc-windows-msvc`. It stops any helpers left running by a dev session first, because they lock their `.exe` files.
- Builds a `prod` app using the version in `package.json`. Bump the version there before building a release.
- Builds in `VITE_ITO_API_BASE_URL` (from the environment or `.env`) as the default server URL.
- Leaves the API key **out** of the installer, and checks the compiled app to make sure the key from `.env` isn't in it. Users enter the key once in **Settings → Server**.
- Leaves the installer unsigned, so Windows SmartScreen shows a warning. Choose **More info → Run anyway**.

Options (they can follow `bun run build:win:local` directly):

| Option | Effect |
|--------|--------|
| `-ServerUrl https://ito.example.com` | Build in a different default server URL. |
| `-NoServerUrl` | Build without a default server URL; users enter it in **Settings → Server**. |
| `-SkipNativeBuild` | Reuse the existing native binaries, e.g. when only TypeScript code changed. |
| `-EmbedApiKey` | Build in `VITE_ITO_API_KEY` from `.env`. Anyone with the installer can extract it. |

To rebuild after code changes: `git pull`, then `bun install` if `package.json` or `bun.lock` changed, bump the version in `package.json`, and run `bun run build:win:local` again.

`bun run build:win` is a different flow: it runs `build-app.sh` through bash and packages inside Docker.

---

## Troubleshooting

### "MSVC not found" errors during Rust build

Ensure Visual Studio Build Tools is installed with the "Desktop development with C++" workload. You may need to restart your terminal after installation.

### `cargo fetch` fails with "no token found" for a registry (`build-binaries.ps1`)

`build-binaries.ps1` points `CARGO_HOME` at `native\.cargo-home`, so it can't see registry mirrors or proxy tokens set up in your user Cargo config, such as a corporate package proxy. `bun run build:win:local` runs plain `cargo build` with your normal Cargo config.

### electron-builder: "Cannot create symbolic link: A required privilege is not held by the client"

electron-builder's `winCodeSign` download contains macOS symlinks, which Windows only lets administrators or Developer Mode create. `bun run build:win:local` extracts it once without those files into `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`. If you run electron-builder by hand, enable Developer Mode or run the build script once first.

### electron-builder: "This project is configured to use yarn" from `pnpm config list`

electron-builder decides which package manager to call from environment variables, and `PNPM_HOME` makes it choose pnpm. The build script removes `PNPM_HOME` for the duration of the build. If you run electron-builder by hand, clear it first (`Remove-Item Env:PNPM_HOME`).

### "rustup: command not found"

The Rust installer adds rustup to your PATH, but you need to restart your terminal (or log out and back in) for the changes to take effect.

### "bun: command not found" in Git Bash

Bun's installer adds itself to PowerShell's PATH. For Git Bash, add this to your `~/.bashrc`:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

Then restart Git Bash or run `source ~/.bashrc`.

### Build script permission errors

If `./build-binaries.sh` fails with permission errors, try:

```bash
bash build-binaries.sh --windows
```

---

## Summary

| Tool | Purpose | Install Command |
|------|---------|-----------------|
| Git Bash | Unix-like shell for build scripts | `winget install -e --id Git.Git` |
| VS Build Tools | MSVC compiler for Rust | `winget install -e --id Microsoft.VisualStudio.2026.BuildTools` |
| Rust | Native component compilation | [rustup.rs](https://rustup.rs/) |
| Node.js | JavaScript runtime | `winget install -e --id OpenJS.NodeJS.LTS` |
| Bun | Fast JS package manager | `irm bun.sh/install.ps1 \| iex` |
