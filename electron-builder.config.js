// Define the native binaries that are shared across platforms
const nativeBinaries = [
  'global-key-listener',
  'audio-recorder',
  'text-writer',
  'active-application',
  'selected-text-reader',
]

const getMacResources = () =>
  nativeBinaries.map(binary => ({
    from: `native/target/\${arch}-apple-darwin/release/${binary}`,
    to: `binaries/${binary}`,
  }))

const getWindowsResources = () =>
  nativeBinaries.map(binary => ({
    from: `native/target/x86_64-pc-windows-msvc/release/${binary}.exe`,
    to: `binaries/${binary}.exe`,
  }))

const stage = process.env.ITO_ENV || 'prod'

// For non-prod builds, ad-hoc sign the entire app bundle after packaging
// This ensures all frameworks have the same identity, allowing TCC permissions to persist
// Only sign the final universal build (arch=universal), not intermediate builds
const afterPack = async context => {
  if (stage === 'prod') return
  if (context.arch !== 3) return // 3 = universal, skip x64 (1) and arm64 (2)

  const { execSync } = require('child_process')
  const path = require('path')
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )

  console.log(`Ad-hoc signing entire app bundle: ${appPath}`)
  try {
    // Sign the entire app bundle recursively with ad-hoc identity
    // --force: replace any existing signatures
    // --deep: sign all nested code (frameworks, helpers, etc.)
    execSync(`codesign --force --deep --sign - "${appPath}"`, {
      stdio: 'inherit',
    })
    console.log('Ad-hoc signing completed successfully')
  } catch (error) {
    console.error('Ad-hoc signing failed:', error.message)
    throw error
  }
}

module.exports = {
  afterPack,
  appId: stage === 'prod' ? 'ai.ito.ito' : `ai.ito.ito-${stage.toLowerCase()}`,
  productName: stage === 'prod' ? 'Ito' : `Ito-${stage}`,
  copyright: 'Copyright © 2025 Demox Labs',
  directories: {
    buildResources: 'resources',
    output: 'dist',
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!.eslintignore',
    '!.eslintrc.cjs',
    '!.prettierignore',
    '!.prettierrc.yaml',
    '!README.md',
    '!.env',
    '!.env.*',
    '!.npmrc',
    '!pnpm-lock.yaml',
    '!tsconfig.json',
    '!tsconfig.node.json',
    '!tsconfig.web.json',
    '!native/**',
    '!build-*.sh',
    {
      from: 'out',
      filter: ['**/*'],
    },
  ],
  asar: true,
  asarUnpack: ['resources/**'],
  extraMetadata: {
    version: process.env.VITE_ITO_VERSION || '0.0.0-dev',
  },
  protocols: {
    name: 'ito',
    schemes: stage === 'prod' ? ['ito'] : [`ito-dev`],
  },
  mac: {
    target: 'default',
    icon: 'resources/build/icon.icns',
    darkModeSupport: true,
    hardenedRuntime: stage === 'prod',
    gatekeeperAssess: false,
    identity: stage === 'prod' ? 'Demox Labs, Inc. (294ZSTM7UB)' : null,
    notarize: stage === 'prod',
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Ito requires microphone access to transcribe your speech.',
    },
    extraResources: [
      ...getMacResources(),
      { from: 'resources/build/ito-logo.png', to: 'build/ito-logo.png' },
    ],
  },
  dmg: {
    artifactName:
      stage === 'prod'
        ? 'Ito-Installer.${ext}'
        : `Ito-${stage}-Installer.\${ext}`,
  },
  win: {
    target: [
      {
        target: 'zip',
        arch: ['x64'],
      },
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    artifactName: '${productName}-${version}.${ext}',
    icon: 'resources/build/icon.ico',
    executableName: 'Ito',
    requestedExecutionLevel: 'asInvoker',
    extraResources: [
      ...getWindowsResources(),
      { from: 'resources/build/ito-logo.png', to: 'build/ito-logo.png' },
    ],
    forceCodeSigning: false,
    asarUnpack: [
      'resources/**',
      '**/node_modules/@sentry/**',
      '**/node_modules/sqlite3/**',
    ],
  },
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  nsis: {
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}-uninstaller',
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    deleteAppDataOnUninstall: true,
  },
}
