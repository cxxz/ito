# Signing and notarizing the macOS client

Run from the repository root on a Mac with Bun, Node.js, Xcode Command Line
Tools, the native build prerequisites, and installed dependencies (`bun install`):

```bash
bun run build:mac:signed -- --check
bun run build:mac:signed
```

`scripts/create_dist_dmg.sh` builds the native components and production client,
signs the Electron app with hardened runtime, creates and signs a DMG, submits it
to Apple's notary service, staples the ticket, and verifies both the disk image
and the enclosed app with Gatekeeper. The installer contains `Ito.app` and an
Applications shortcut. Output goes into a new `dist/signed-macos-<arch>.*` folder,
alongside a SHA-256 checksum and notarization receipts. Nothing is published to
GitHub or an update feed.

This follows the Keychain-profile approach in
`hpe-openwork-legacy/apps/desktop/create_dist_dmg.sh`. Electron Builder handles
signing the nested Electron frameworks, helper apps, native executables, and
Node modules. The existing macOS entitlements are retained. The separate signed
build configuration overrides the upstream Demox signing identity without
changing the normal `build:mac` or CI signing flow.

## Certificate and notarization account

The script automatically selects the only valid **Developer ID Application**
certificate available in the local Keychain. If multiple certificates exist,
select one by SHA-1 or its complete name:

```bash
security find-identity -v -p codesigning
bun run build:mac:signed -- \
  --apple-signing-identity "Developer ID Application: Cong Xu (QR3T77P7VK)" \
  --notary-profile hpe-cowork
```

The default notarization Keychain profile is `hpe-cowork`, matching the reference
script. `APPLE_SIGNING_IDENTITY` and `NOTARY_PROFILE` can also supply these
defaults. No certificate, password, or notarization token is written into the
repository. To configure a different profile, use Apple's interactive prompt:

```bash
xcrun notarytool store-credentials ito-notary
bun run build:mac:signed -- --notary-profile ito-notary
```

The profile's Apple developer team must be authorized to notarize this
certificate's software. An HTTP 403 reporting a missing or expired agreement
requires the team's Account Holder to review and accept the applicable agreement
in the [Apple Developer account](https://developer.apple.com/account/), then run
`--check` again. This is an account issue; rebuilding or changing the app's
entitlements will not resolve it.

## Build choices and resuming notarization

The target defaults to the host architecture. The release version defaults to
`package.json`. Existing native binaries can be reused when they match the
current source and target architecture:

```bash
bun run build:mac:signed -- --arch arm64 --version 0.2.3 --skip-native-build
# For Intel Macs, build the native components for x64 too:
bun run build:mac:signed -- --arch x64
```

To build and sign while notarization access is unavailable:

```bash
bun run build:mac:signed -- --skip-notarize
```

This produces a **signed but unnotarized** installer. After resolving the account
issue, notarize that same DMG without rebuilding:

```bash
bun run build:mac:signed -- --notarize-dmg /absolute/path/to/Ito-0.2.3-macos-arm64.dmg
```

The script saves the submission ID before waiting for Apple. If waiting times
out, repeat `--notarize-dmg` with the same path and profile to resume that
submission. Rejected submissions produce a `.notary-log.json` file for diagnosis;
fix the reported signing issue and create a new installer. A completed run must
pass ticket validation and Gatekeeper before reporting success. The final DMG
is the distribution artifact; the intermediate app directory is not stapled.

Use `--output-dir` to select a **new** output directory, and `--help` for all
options. Existing output directories are not overwritten.

## Client configuration

This script always builds the `prod` app profile, regardless of the development
`.env`. It clears the embedded API URL/key defaults, platform override, and
updater configuration before building. Set the connection in **Settings →
Server** after installation. Existing saved settings in the production profile
continue to work. This independently signed release does not download updates
from the upstream publisher; distribute subsequent DMGs yourself.

The installed app needs its own macOS Accessibility permission to activate
shortcuts in other apps. In **Settings → Keyboard**, an access notice appears
when this permission is missing. Shortcut editing works inside Ito without that
permission, and the global listener starts after access is granted. Use **Add
Fn** while editing if macOS does not deliver the Fn key to the window.

Only runtime assets and production dependencies are packaged. Workspace source
files and `.env` files are excluded. Server-side environment files are neither
read nor changed.

See Apple's [notarization workflow documentation](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
for details on submission, stapling, and Gatekeeper checks.
