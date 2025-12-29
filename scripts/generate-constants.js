#!/usr/bin/env node

/**
 * Script to generate TypeScript constants files from the root shared-constants.js
 * This ensures all parts of the monorepo use the same default values
 */

const fs = require('fs')
const path = require('path')

// Import the shared constants
const { DEFAULT_ADVANCED_SETTINGS } = require('../shared-constants.js')

// Template for generated TypeScript files
const generateTSFile = targetPath => `/* 
 * AUTO-GENERATED FILE - DO NOT EDIT
 * Generated from /shared-constants.js
 * Run 'bun generate:constants' to regenerate
 */

export const DEFAULT_ADVANCED_SETTINGS = {
  // ASR (Automatic Speech Recognition) settings
  asrProvider: '${DEFAULT_ADVANCED_SETTINGS.asrProvider}',
  asrModel: '${DEFAULT_ADVANCED_SETTINGS.asrModel}',
  asrPrompt: \`${DEFAULT_ADVANCED_SETTINGS.asrPrompt}\`,
  
  // LLM (Large Language Model) settings
  llmProvider: '${DEFAULT_ADVANCED_SETTINGS.llmProvider}',
  llmModel: '${DEFAULT_ADVANCED_SETTINGS.llmModel}',
  llmTemperature: ${DEFAULT_ADVANCED_SETTINGS.llmTemperature},
  llmBaseUrl: '${DEFAULT_ADVANCED_SETTINGS.llmBaseUrl}',
  
  // Prompt settings
  transcriptionPrompt: \`${DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt.replace(/`/g, '\\`')}\`,
  editingPrompt: \`${DEFAULT_ADVANCED_SETTINGS.editingPrompt.replace(/`/g, '\\`')}\`,
  
  // Audio quality thresholds
  noSpeechThreshold: ${DEFAULT_ADVANCED_SETTINGS.noSpeechThreshold},

  // Polish mode settings for TRANSCRIBE
  polishEnabled: ${DEFAULT_ADVANCED_SETTINGS.polishEnabled},
  polishLlmProvider: '${DEFAULT_ADVANCED_SETTINGS.polishLlmProvider}',
  polishLlmModel: '${DEFAULT_ADVANCED_SETTINGS.polishLlmModel}',
  polishLlmTemperature: ${DEFAULT_ADVANCED_SETTINGS.polishLlmTemperature},
} as const;
`

// Paths to generate files
const targets = [
  'lib/constants/generated-defaults.ts',
  'server/src/constants/generated-defaults.ts',
]

console.log('🔄 Generating constants files...')

targets.forEach(target => {
  const fullPath = path.join(__dirname, '..', target)
  const dir = path.dirname(fullPath)

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Write the generated file
  fs.writeFileSync(fullPath, generateTSFile(target))
  console.log(`✅ Generated: ${target}`)
})

// Format the generated files using prettier
console.log('🎨 Formatting generated files...')
const { execSync } = require('child_process')

targets.forEach(target => {
  try {
    execSync(`bunx prettier --write "${target}"`, { stdio: 'inherit' })
    console.log(`✅ Formatted: ${target}`)
  } catch (error) {
    console.warn(`⚠️  Could not format ${target}:`, error.message)
  }
})

console.log('🎉 Constants generation complete!')
