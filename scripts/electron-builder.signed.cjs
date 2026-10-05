const base = require('../electron-builder.config.js')

if (!process.env.ITO_MAC_SIGNING_IDENTITY) {
  throw new Error('Use scripts/create_dist_dmg.sh to build a signed release')
}

module.exports = {
  ...base,
  afterPack: undefined,
  forceCodeSigning: true,
  // Ship runtime files and production dependencies, never the workspace or .env.
  files: [
    'out/**/*',
    'resources/**/*',
    'package.json',
    '!**/.env',
    '!**/.env.*',
  ],
  mac: {
    ...base.mac,
    target: 'dir',
    identity: process.env.ITO_MAC_SIGNING_IDENTITY,
    type: 'distribution',
    hardenedRuntime: true,
    // The shell script submits the final DMG using a Keychain profile.
    notarize: false,
  },
}
