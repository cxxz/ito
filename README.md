# Ito

<div align="center">
  <img src="resources/build/icon.png" width="128" height="128" alt="Ito Logo" />
  
  <h3>Smart dictation. Everywhere you want.</h3>
  
  <p>
    <strong>Ito</strong> is an intelligent voice assistant that brings seamless voice dictation to any application on your computer. Simply hold down your trigger key, speak naturally, and watch your words appear instantly in any text field.
  </p>

  <p>
    <img alt="macOS" src="https://img.shields.io/badge/macOS-supported-blue?logo=apple&logoColor=white">
    <img alt="Windows" src="https://img.shields.io/badge/Windows-supported-blue?logo=windows&logoColor=white">
    <img alt="Version" src="https://img.shields.io/badge/version-0.2.3-green">
    <img alt="License" src="https://img.shields.io/badge/license-GPL-blue">
  </p>
</div>

---

## ✨ Features

### 🎙️ **Universal Voice Dictation**

- **Works in any app**: Emails, documents, chat applications, web browsers, code editors
- **Global keyboard shortcuts**: Customizable trigger keys that work system-wide
- **Real-time transcription**: High-accuracy speech-to-text powered by advanced AI models
- **Instant text insertion**: Automatically types transcribed text into the focused text field

### 🧠 **Smart & Adaptive**

- **Custom dictionary**: Add technical terms, names, and specialized vocabulary
- **Context awareness**: Learns from your usage patterns to improve accuracy
- **Multi-language support**: Transcribe in multiple languages
- **Intelligent punctuation**: Automatically adds appropriate punctuation

### ⚙️ **Powerful Customization**

- **Flexible shortcuts**: Configure any key combination as your trigger
- **Audio preferences**: Choose your preferred microphone
- **Privacy controls**: Local processing options and data control settings
- **Seamless integration**: Works with any application

### 💾 **Data Management**

- **Notes system**: Automatically save transcriptions for later reference
- **Interaction history**: Track your dictation sessions and improve over time
- **Self-hosted storage**: Data lives in a local SQLite database and syncs to your own Ito server — no third-party cloud
- **Export capabilities**: Export your notes and interaction data

---

## 🚀 Quick Start

### Prerequisites

- **macOS 10.15+** or **Windows 10+**
- **Node.js 20+** and **Bun** (for development)
- **Rust toolchain** (for building native components)
- **Microphone access** and **Accessibility permissions**

### Installation

1. **Download the latest release** from [heyito.ai](https://www.heyito.ai/) or the [GitHub releases page](https://github.com/heyito/ito/releases)

2. **Install the application**:
   - **macOS**: Open the `.dmg` file and drag Ito to Applications
   - **Windows**: Run the `.exe` installer and follow the setup wizard

3. **Grant permissions** when prompted:
   - **Microphone access**: Required for voice input
   - **Accessibility access**: Required for global keyboard shortcuts and text insertion

4. **Run your Ito server**: Ito is self-hosted — point the app at your own running server (see [server/README.md](server/README.md)). The desktop app and server authenticate via a shared API key (`VITE_GRPC_API_KEY` ↔ `ITO_API_KEY`); no third-party identity provider is involved.

### First Use

1. **Complete onboarding**: Walk through the in-app welcome flow (permissions, microphone test, keyboard test, intelligent mode intro, data control)
2. **Configure your trigger key**: Choose a comfortable keyboard shortcut (default: `Fn + Space`)
3. **Try it out**: Hold your trigger key and speak into any text field
4. **Customize settings**: Adjust audio, shortcuts, dictionary, and advanced provider/model preferences in **Settings**

---

## 🛠️ Development

### Building from Source

> **Important**: Ito requires a local transcription server for voice processing. See [server/README.md](server/README.md) for detailed server setup instructions.

```bash
# Clone the repository
git clone https://github.com/heyito/ito.git
cd ito

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env

# Build native components (Rust binaries)
./build-binaries.sh

	# Set up and start the server (required for transcription)
	cd server
	cp .env.example .env  # Edit with your API keys
	# Optional: tweak server-controlled defaults that the app shows in Settings > Advanced
	# (e.g. ASR_PROVIDER, GROQ_DEFAULT_ASR_MODEL, OPENAI_DEFAULT_LLM). See server/README.md.
	bun install
	bun run local-db-up   # Start PostgreSQL database
	bun run db:migrate    # Run database migrations
	bun run dev           # Start development server
	cd ..

# Start the Electron app (in a new terminal)
bun run dev
```

### Build Requirements

#### All Platforms

- **Rust**: Install via [rustup.rs](https://rustup.rs/)
  - **Windows users**: See Windows-specific instructions below for GNU toolchain setup
  - **macOS/Linux users**: Default installation is sufficient

#### macOS

- **Xcode Command Line Tools**: `xcode-select --install`

#### Windows

**Required Setup:**

This setup uses git bash for shell operations. Download from [git](https://git-scm.com/downloads)

1. **Install Docker Desktop**: Download from [docker.com](https://www.docker.com/products/docker-desktop/) and ensure it's running

2. **Install Rust** (with GNU target)

Download and run the official [Rust installer for Windows](https://rustup.rs/).  
This installs `rustup` and the MSVC toolchain by default.

Add the GNU target (needed for our native components):

    rustup toolchain install stable-x86_64-pc-windows-gnu
    rustup target add x86_64-pc-windows-gnu

---

3. **Install 7-Zip**

   winget install 7zip.7zip

---

4. **Install GCC & MinGW-w64 via MSYS2**

Install [MSYS2](https://www.msys2.org/).

Open the **MSYS2 MinGW x64** shell (from the Start Menu).

Update and install the toolchain:

    pacman -Syu       # run twice if asked to restart
    pacman -S --needed mingw-w64-x86_64-toolchain

Verify the tools exist:

    ls /mingw64/bin/gcc.exe /mingw64/bin/dlltool.exe

---

5. **Use the MinGW tools when building** (Git Bash)

You normally develop and build in **Git Bash**. Before building, prepend the MinGW path:

    export PATH="/c/msys64/mingw64/bin:$PATH"
    export DLLTOOL="/c/msys64/mingw64/bin/dlltool.exe"
    export CC_x86_64_pc_windows_gnu="/c/msys64/mingw64/bin/x86_64-w64-mingw32-gcc.exe"
    export AR_x86_64_pc_windows_gnu="/c/msys64/mingw64/bin/ar.exe"
    export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="/c/msys64/mingw64/bin/x86_64-w64-mingw32-gcc.exe"

Check you’re picking up the right ones:

    which gcc       # -> /c/msys64/mingw64/bin/gcc.exe
    which dlltool   # -> /c/msys64/mingw64/bin/dlltool.exe

⚠️ **Do not add `C:\msys64\ucrt64\bin` to PATH.** That’s the wrong runtime and will break linking.

💡 To avoid running these exports every session, add the lines above to your Git Bash `~/.bashrc` file. They will be applied automatically whenever you open a new Git Bash window.

---

6.  **Restart Git Bash if you update MSYS2**

Whenever you update MSYS2 packages with `pacman -Syu`, restart Git Bash so the changes take effect.

> **Note**: Windows builds use Docker for cross-compilation to ensure consistent builds. The Docker container handles the Windows build environment automatically.

### Project Structure

```
ito/
├── app/                    # Electron renderer (React frontend)
│   ├── components/         # React components
│   ├── store/             # Zustand state management
│   └── styles/            # TailwindCSS styles
├── lib/                   # Shared library code
│   ├── main/              # Electron main process
│   ├── preload/           # Preload scripts & IPC
│   └── media/             # Audio/keyboard native interfaces
├── native/                # Native components (Rust/Swift)
│   ├── audio-recorder/    # Audio capture (Rust)
│   ├── global-key-listener/ # Keyboard events (Rust)
│   ├── text-writer/       # Text insertion (Rust)
│   ├── active-application/ # Active window detection (Rust)
│   ├── selected-text-reader/ # Selected text extraction (Rust)
│   ├── cursor-context/    # Cursor position context (Swift, macOS)
│   └── macos-text/        # Text accessibility utilities (Swift, macOS)
├── server/                # gRPC transcription server (self-hosted)
│   ├── src/               # Server implementation (Fastify + Connect RPC)
│   ├── scripts/           # Migration helpers
│   └── docker-compose.yml # Postgres + server containers
└── resources/             # Build resources & assets
```

### Available Scripts

```bash
# Development
bun run dev                 # Start with hot reload
bun run dev:rust           # Build Rust components and start dev

# Building Native Components
./build-binaries.sh --mac   # Build for macOS (universal binary)
./build-binaries.sh --windows # Build for Windows

# Building Application
bun run build:mac          # Build for macOS
bun run build:win          # Build for Windows
./build-app.sh mac          # Build macOS using build script
./build-app.sh windows      # Build Windows using build script

# Code Quality
bun run lint               # Run ESLint
bun run format             # Check formatting with Prettier
bun run lint:fix           # Fix linting issues
bun run format:fix         # Fix formatting issues

# Testing
bun runAllTests            # Run all tests (lib, server, app, native)
bun runLibTests            # Run lib tests only
bun runServerTests         # Run server tests only
bun runAppTests            # Run app tests only
bun runNativeTests         # Run native (Rust) tests only
```

---

## 🏗️ Architecture

### Client Architecture

**Ito** is built as a modern Electron application with a sophisticated multi-process architecture:

- **Main Process**: Handles system integration, permissions, and native component coordination
- **Renderer Process**: React-based UI with real-time audio visualization
- **Preload Scripts**: Secure IPC bridge between main and renderer processes
- **Native Components**: High-performance Rust binaries for audio capture and keyboard handling

### Technology Stack

**Frontend:**

- **Electron** - Cross-platform desktop framework
- **React 19** - Modern UI library with concurrent features
- **TypeScript** - Type-safe development
- **TailwindCSS** - Utility-first styling
- **Zustand** - Lightweight state management
- **Framer Motion** - Smooth animations

**Backend (self-hosted server):**

- **Bun** - Runtime environment
- **Fastify + Connect RPC** - HTTP/gRPC server
- **PostgreSQL** - Server-side data storage
- **SQLite** - Local data storage in the desktop app
- **Protocol Buffers** - Efficient data serialization
- **Multi-LLM/ASR providers** - Groq, Cerebras, OpenAI, Aliyun (or any OpenAI-compatible endpoint, e.g. local Whisper via Vox-Box)

**Native Components:**

- **Rust** - System-level audio recording and keyboard event handling
- **Swift** - macOS-specific text manipulation and accessibility features
- **cpal** - Cross-platform audio library
- **enigo** - Cross-platform input simulation

**Infrastructure:**

- **Docker Compose** - Local server + Postgres for development and self-hosting
- **Shared API key** - Simple `x-ito-api-key` authentication between app and server

### Communication Flow

```mermaid
graph TD
    A[User Holds Trigger Key] --> B[Global Key Listener]
    B --> C[Main Process]
    C --> D[Audio Recorder Service]
    D --> E[gRPC Transcription Service]
    E --> F[AI Transcription Model]
    F --> G[Transcribed Text]
    G --> H[Text Writer Service]
    H --> I[Active Text Field]
```

---

## 🔧 Configuration

### Keyboard Shortcuts

Customize your trigger keys in **Settings > Keyboard**:

- **Single key**: `Space`, `Fn`, etc.
- **Key combinations**: `Cmd + Space`, `Ctrl + Shift + V`, etc.
- **Complex shortcuts**: `Fn + Cmd + Space` for advanced workflows

### Audio Settings

Fine-tune audio capture in **Settings > Audio**:

- **Microphone selection**: Choose from available input devices
- **Sensitivity adjustment**: Optimize for your voice and environment
- **Noise reduction**: Filter background noise automatically
- **Audio feedback**: Enable/disable sound effects

### Privacy & Data

Control your data in **Settings > General** and **Settings > Advanced**:

- **Self-hosted by default**: Audio is sent only to the Ito server you run
- **Pluggable providers**: Choose ASR/LLM providers per workload (Groq, Cerebras, OpenAI, Aliyun) or point at a local OpenAI-compatible endpoint for fully offline transcription (see [developers/MACOS-LOCAL-DEPLOY.md](developers/MACOS-LOCAL-DEPLOY.md))
- **Analytics**: Share anonymous usage data (optional)
- **Data export**: Download your notes and interaction history

---

## 🔒 Privacy & Security

### Data Handling

- **Self-hosted**: Voice processing runs through the Ito server you operate; nothing is sent to a hosted Ito service
- **Fully offline option**: Pair the server with a local Whisper model for end-to-end on-device transcription
- **Minimal data collection**: Only essential data is processed and stored
- **User control**: Full control and transparency over data retention and deletion

### Permissions

**Ito** requires specific system permissions to function:

- **Microphone Access**: To capture your voice for transcription
- **Accessibility Access**: To detect keyboard shortcuts and insert text
- **Network Access**: To reach your Ito server and any external ASR/LLM providers you configure

### Open Source

This project is open source under the GNU General Public License. You can:

- Audit the source code for security and privacy
- Contribute improvements and bug fixes
- Fork and customize for your specific needs
- Report security issues through responsible disclosure

---

## 🤝 Contributing

We welcome contributions! Whether you're fixing bugs, adding features, or improving documentation, your help makes **Ito** better for everyone.

### Getting Started

1. **Fork the repository** and clone your fork
2. **Create a feature branch** from `dev`
3. **Make your changes** with clear commit messages
4. **Test thoroughly** across supported platforms
5. **Submit a pull request** with a detailed description

### Development Guidelines

- **Code Style**: Use Prettier and ESLint configurations
- **Type Safety**: Maintain strong TypeScript typing
- **Testing**: Add tests for new features
- **Documentation**: Update docs for API changes
- **Performance**: Consider impact on time between recording and text insertion

### Areas for Contribution

- **Accuracy improvements**: Better transcription algorithms
- **Language support**: Additional language models
- **UI/UX enhancements**: Better user experience
- **Platform support**: Windows stability testing, Linux compatibility
- **Documentation**: Tutorials, guides, and examples

---

## 📄 License

This project is licensed under the **GNU General Public License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

**Ito** is built with and inspired by amazing open source projects:

- **[Electron React App](https://github.com/guasam/electron-react-app)** by @guasam - The foundational template that provided our modern Electron + React architecture
- **Electron** - Cross-platform desktop apps with web technologies
- **React** - Modern UI development
- **Rust** - Systems programming language for native components
- **gRPC** - High-performance RPC framework
- **TailwindCSS** - Utility-first CSS framework

---

## 📞 Support

- **Community**: [GitHub Discussions](https://github.com/heyito/ito/discussions)
- **Issues**: [GitHub Issues](https://github.com/heyito/ito/issues)
- **Website**: [heyito.ai](https://www.heyito.ai)
