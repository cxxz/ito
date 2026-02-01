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

The MSVC toolchain is required for compiling native Rust components.

### Option A: Using winget

```powershell
winget install -e --id Microsoft.VisualStudio.2022.BuildTools
```

After installation, you need to add the C++ workload. Run the Visual Studio Installer and select "Desktop development with C++".

### Option B: Command-Line Installation (Full)

Download and run the bootstrapper with the C++ workload pre-selected:

```powershell
# Download the installer
Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_buildtools.exe" -OutFile "$env:TEMP\vs_buildtools.exe"

# Install with C++ workload
Start-Process -FilePath "$env:TEMP\vs_buildtools.exe" -ArgumentList "--add", "Microsoft.VisualStudio.Workload.VCTools", "--includeRecommended", "--passive", "--norestart", "--wait" -Wait
```

### Option C: Manual Download

1. Go to [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. Download "Build Tools for Visual Studio 2022"
3. Run the installer
4. Select **"Desktop development with C++"** workload
5. Click Install

### Verify Installation

After installation, restart your terminal. The MSVC compiler should be available when Rust needs it.

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

Once all dependencies are installed, you can build Ito:

```bash
# Clone the repository (if not already done)
git clone https://github.com/heyito/ito.git
cd ito

# Install JavaScript dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env to set VITE_LOCAL_SERVER_HOST to your remote server URL

# Build native Rust binaries
./build-binaries.sh --windows

# Build the Electron app
bun run electron-vite build

# Create Windows installer
bunx electron-builder --config electron-builder.config.js --win --x64 --publish=never
```

The installer will be created in the `dist/` directory.

---

## Troubleshooting

### "MSVC not found" errors during Rust build

Ensure Visual Studio Build Tools is installed with the "Desktop development with C++" workload. You may need to restart your terminal after installation.

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
| VS Build Tools | MSVC compiler for Rust | `winget install -e --id Microsoft.VisualStudio.2022.BuildTools` |
| Rust | Native component compilation | [rustup.rs](https://rustup.rs/) |
| Node.js | JavaScript runtime | `winget install -e --id OpenJS.NodeJS.LTS` |
| Bun | Fast JS package manager | `irm bun.sh/install.ps1 \| iex` |
