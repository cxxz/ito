#!/usr/bin/env bash
# Build and sign Ito with a local Developer ID, then notarize the final DMG.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-hpe-cowork}"
ARCH="$(uname -m)"
[ "$ARCH" != x86_64 ] || ARCH=x64
VERSION=""
OUTPUT_DIR=""
EXISTING_DMG=""
SKIP_NATIVE=0
SKIP_NOTARIZE=0
CHECK_ONLY=0
STAGING_DIR=""
MOUNT_POINT=""

usage() {
  cat <<'EOF'
Usage: bun run build:mac:signed -- [options]

Builds a production Ito.app and a signed DMG. Defaults to this Mac's architecture
and the sole available Developer ID Application certificate. Notarization uses
the existing "hpe-cowork" Keychain profile; no passwords are stored in this repo.

Options:
  --apple-signing-identity ID  Certificate SHA-1 or full certificate name
  --notary-profile NAME       notarytool Keychain profile (default: hpe-cowork)
  --arch arm64|x64            Target architecture (default: this Mac)
  --version VERSION          Release version (default: package.json version)
  --output-dir DIR           New output directory (default: unique dist folder)
  --skip-native-build        Reuse existing Rust/Swift release binaries
  --skip-notarize            Sign only; result is NOT notarized
  --notarize-dmg PATH        Notarize/resume an existing signed DMG; no rebuild
  --check                   Check signing tools, identity and notary credentials
  -h, --help                Show this help

The build excludes embedded API URL/key defaults. Set them in Settings > Server.
It also disables automatic updates for this independently signed distribution.
Server-side settings are never read or changed.
EOF
}

info() { printf '\n==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
value_required() { [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 requires a value"; }
json_value() { plutil -extract "$2" raw -o - "$1"; }

cleanup() {
  if [ -n "$MOUNT_POINT" ]; then
    hdiutil detach "$MOUNT_POINT" -quiet || true
  fi
  if [ -n "$STAGING_DIR" ]; then
    rm -rf "$STAGING_DIR"
  fi
}
trap cleanup EXIT

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apple-signing-identity) value_required "$@"; SIGNING_IDENTITY="$2"; shift 2 ;;
    --notary-profile) value_required "$@"; NOTARY_PROFILE="$2"; shift 2 ;;
    --arch) value_required "$@"; ARCH="$2"; shift 2 ;;
    --version) value_required "$@"; VERSION="$2"; shift 2 ;;
    --output-dir) value_required "$@"; OUTPUT_DIR="$2"; shift 2 ;;
    --notarize-dmg) value_required "$@"; EXISTING_DMG="$2"; shift 2 ;;
    --skip-native-build) SKIP_NATIVE=1; shift ;;
    --skip-notarize) SKIP_NOTARIZE=1; shift ;;
    --check) CHECK_ONLY=1; shift ;;
    --) shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

[ "$(uname -s)" = Darwin ] || die 'This script requires macOS.'
case "$ARCH" in arm64|x64) ;; *) die '--arch must be arm64 or x64' ;; esac
if [ -n "$EXISTING_DMG" ] && [ "$SKIP_NOTARIZE" = 1 ]; then
  die '--notarize-dmg cannot be combined with --skip-notarize'
fi
for cmd in codesign security ditto hdiutil plutil shasum xcrun spctl; do
  command -v "$cmd" >/dev/null || die "Missing command: $cmd"
done
xcrun --find notarytool >/dev/null
xcrun --find stapler >/dev/null

# Resolve an exact valid Developer ID certificate. Never fall back to ad-hoc signing.
MATCHES=0
IDENTITIES=$(security find-identity -v -p codesigning)
while IFS= read -r line; do
  case "$line" in *\"Developer\ ID\ Application:*\") ;; *) continue ;; esac
  hash=$(printf '%s\n' "$line" | awk '{print $2}')
  name=$(printf '%s\n' "$line" | cut -d '"' -f 2)
  if [ -z "$SIGNING_IDENTITY" ] || [ "$SIGNING_IDENTITY" = "$hash" ] || [ "$SIGNING_IDENTITY" = "$name" ]; then
    SIGNING_HASH="$hash"
    SIGNING_NAME="$name"
    MATCHES=$((MATCHES + 1))
  fi
done <<< "$IDENTITIES"
[ "$MATCHES" -gt 0 ] || die 'No matching valid Developer ID Application identity in the Keychain.'
[ "$MATCHES" = 1 ] || die 'Multiple Developer ID identities found; select one with --apple-signing-identity.'
info "Signing identity: $SIGNING_NAME ($SIGNING_HASH)"

if [ "$SKIP_NOTARIZE" = 0 ]; then
  [ -n "$NOTARY_PROFILE" ] || die 'A notarytool Keychain profile is required.'
  info "Checking Apple notarization access with profile: $NOTARY_PROFILE"
  if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" --output-format json >/dev/null; then
    die 'Apple notarization preflight failed. Resolve the reported account/agreement or Keychain profile issue, or use --skip-notarize to build a signed-only DMG.'
  fi
fi
[ "$CHECK_ONLY" = 0 ] || { info 'Preflight passed.'; exit 0; }

if [ -n "$EXISTING_DMG" ]; then
  [ -f "$EXISTING_DMG" ] || die "DMG not found: $EXISTING_DMG"
  DMG_PATH="$(cd "$(dirname "$EXISTING_DMG")" && pwd -P)/$(basename "$EXISTING_DMG")"
else
  command -v bun >/dev/null || die 'Install Bun and run bun install first.'
  command -v node >/dev/null || die 'Node.js is required by Electron Builder.'
  cd "$ROOT"
  [ -d node_modules/electron-builder ] || die 'Run bun install first.'
  VERSION="${VERSION:-$(node -p 'require("./package.json").version')}"
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || die 'Invalid release version.'
  if [ -z "$OUTPUT_DIR" ]; then
    mkdir -p "$ROOT/dist"
    OUTPUT_DIR=$(mktemp -d "$ROOT/dist/signed-macos-${ARCH}.XXXXXX")
  else
    # Do not overwrite a previous installer or build directory.
    [ ! -e "$OUTPUT_DIR" ] || die '--output-dir must be a new directory.'
    mkdir -p "$OUTPUT_DIR"
    OUTPUT_DIR=$(cd "$OUTPUT_DIR" && pwd -P)
  fi

  # Existing process variables take precedence over Vite/Bun .env files.
  # Do not source .env: releases are configured through the desktop Settings UI.
  export VITE_ITO_APP_ENV=prod VITE_ITO_APP_VERSION="$VERSION"
  export VITE_ITO_API_BASE_URL='' VITE_ITO_API_KEY=''
  export VITE_ITO_PLATFORM_OVERRIDE='' VITE_ITO_UPDATER_BUCKET=''
  export VITE_ITO_ENABLE_DEV_UPDATES=false
  export ITO_MAC_SIGNING_IDENTITY="$SIGNING_HASH" CSC_IDENTITY_AUTO_DISCOVERY=true
  unset CSC_LINK CSC_KEY_PASSWORD CSC_INSTALLER_LINK CSC_INSTALLER_KEY_PASSWORD

  if [ "$SKIP_NATIVE" = 0 ]; then
    info "Building native binaries for $ARCH"
    if [ "$ARCH" = x64 ]; then
      bash ./build-binaries.sh --mac --x64
    else
      bash ./build-binaries.sh --mac
    fi
  fi
  for binary in global-key-listener audio-recorder text-writer active-application selected-text-reader; do
    binary_path="$ROOT/native/target/${ARCH}-apple-darwin/release/$binary"
    [ -x "$binary_path" ] || die "Missing native binary: $binary_path; rerun without --skip-native-build."
    expected_arch="$ARCH"
    [ "$ARCH" != x64 ] || expected_arch=x86_64
    lipo "$binary_path" -verify_arch "$expected_arch"
  done

  info "Building Ito $VERSION ($ARCH) without embedded server credentials"
  bun run electron-vite build
  bun run electron-builder --config scripts/electron-builder.signed.cjs \
    --mac --dir "--$ARCH" --publish=never "-c.directories.output=$OUTPUT_DIR"

  APP_PATH="$OUTPUT_DIR/mac-$ARCH/Ito.app"
  [ "$ARCH" != x64 ] || APP_PATH="$OUTPUT_DIR/mac/Ito.app"
  [ -d "$APP_PATH" ] || die "Packaged app not found: $APP_PATH"
  codesign --verify --deep --strict --verbose=2 "$APP_PATH"
  app_signature=$(codesign -dv --verbose=4 "$APP_PATH" 2>&1)
  [[ "$app_signature" == *"Authority=$SIGNING_NAME"* ]] || die 'App was signed with an unexpected identity.'
  [[ "$app_signature" == *'(runtime)'* ]] || die 'App is missing hardened runtime.'

  STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ito-dist-dmg.XXXXXX")
  ditto "$APP_PATH" "$STAGING_DIR/Ito.app"
  ln -s /Applications "$STAGING_DIR/Applications"
  DMG_PATH="$OUTPUT_DIR/Ito-${VERSION}-macos-${ARCH}.dmg"
  info "Creating and signing $DMG_PATH"
  hdiutil create -volname "Ito $VERSION" -srcfolder "$STAGING_DIR" -format UDZO "$DMG_PATH"
  codesign --timestamp --sign "$SIGNING_HASH" "$DMG_PATH"
fi

codesign --verify --verbose=2 "$DMG_PATH"
dmg_signature=$(codesign -dv --verbose=4 "$DMG_PATH" 2>&1)
[[ "$dmg_signature" == *"Authority=$SIGNING_NAME"* ]] || die 'DMG was signed with an unexpected identity.'
hdiutil verify "$DMG_PATH"

if [ "$SKIP_NOTARIZE" = 0 ]; then
  RECEIPT="$DMG_PATH.notary-submission.json"
  if ! xcrun stapler validate "$DMG_PATH" >/dev/null 2>&1; then
    UPLOAD_HASH=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')
    if [ -e "$RECEIPT" ]; then
      json_value "$RECEIPT" id >/dev/null 2>&1 || die "Incomplete submission receipt: $RECEIPT. Check notarytool history before submitting again."
      [ -f "$DMG_PATH.notary-upload.sha256" ] || die 'Missing upload checksum beside notarization receipt.'
      [ "$(cat "$DMG_PATH.notary-upload.sha256")" = "$UPLOAD_HASH" ] || die 'DMG changed since submission; refusing to reuse its receipt.'
      info 'Resuming saved notarization submission'
    else
      info "Submitting DMG to Apple using profile: $NOTARY_PROFILE"
      printf '%s\n' "$UPLOAD_HASH" > "$DMG_PATH.notary-upload.sha256"
      xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" \
        --output-format json > "$RECEIPT"
    fi
    SUBMISSION_ID=$(json_value "$RECEIPT" id)
    info "Waiting for Apple submission $SUBMISSION_ID (receipt: $RECEIPT)"
    WAIT_SUCCEEDED=1
    xcrun notarytool wait "$SUBMISSION_ID" --keychain-profile "$NOTARY_PROFILE" \
      --timeout 30m --output-format json > "$DMG_PATH.notary-status.json" || WAIT_SUCCEEDED=0
    STATUS=$(json_value "$DMG_PATH.notary-status.json" status 2>/dev/null || true)
    if [ "$STATUS" = Invalid ] || [ "$STATUS" = Rejected ]; then
      xcrun notarytool log "$SUBMISSION_ID" --keychain-profile "$NOTARY_PROFILE" \
        "$DMG_PATH.notary-log.json" || true
      die "Apple returned $STATUS. See $DMG_PATH.notary-log.json"
    fi
    if [ "$WAIT_SUCCEEDED" = 0 ] || [ "$STATUS" != Accepted ]; then
      die 'Notarization wait failed or timed out. Rerun with --notarize-dmg and the same path to resume without uploading again.'
    fi
    xcrun stapler staple "$DMG_PATH"
  fi
  xcrun stapler validate "$DMG_PATH"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG_PATH"
fi

info 'Checking the installer layout and enclosed app signature'
[ -n "$STAGING_DIR" ] || STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ito-dist-dmg.XXXXXX")
MOUNT_POINT="$STAGING_DIR/mount"
mkdir "$MOUNT_POINT"
hdiutil attach "$DMG_PATH" -readonly -nobrowse -mountpoint "$MOUNT_POINT" -quiet
[ -d "$MOUNT_POINT/Ito.app" ] || die 'DMG is missing Ito.app.'
[ -L "$MOUNT_POINT/Applications" ] || die 'DMG is missing the Applications symlink.'
codesign --verify --deep --strict --verbose=2 "$MOUNT_POINT/Ito.app"
if [ "$SKIP_NOTARIZE" = 0 ]; then
  spctl --assess --type execute --verbose=2 "$MOUNT_POINT/Ito.app"
fi
hdiutil detach "$MOUNT_POINT" -quiet
MOUNT_POINT=""

shasum -a 256 "$DMG_PATH" > "$DMG_PATH.sha256"
if [ "$SKIP_NOTARIZE" = 1 ]; then
  info "Signed only, NOT notarized: $DMG_PATH"
  printf 'To notarize later:\n  bun run build:mac:signed -- --notarize-dmg %q --notary-profile %q\n' "$DMG_PATH" "$NOTARY_PROFILE"
else
  info "Signed, notarized, stapled and verified: $DMG_PATH"
fi
