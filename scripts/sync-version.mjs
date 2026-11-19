#!/usr/bin/env node
/**
 * Copy the version from the root package.json into the workspace packages.
 *
 * The root manifest is the single source of truth: it is what a human bumps and
 * what the release tag must match. Electron reads apps/desktop/package.json at
 * runtime (`app.getVersion()`), and the built renderer gets the root version
 * injected as `__WEGRAM_VERSION__` by the Vite configs, so those copies must not
 * drift.
 *
 *   pnpm version 0.2.1 --no-git-tag-version
 *   pnpm sync-version
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = ['apps/desktop/package.json', 'packages/protocol/package.json']

function readManifest(relative) {
  return JSON.parse(readFileSync(join(rootDir, relative), 'utf8'))
}

const root = readManifest('package.json')
if (typeof root.version !== 'string' || root.version.length === 0) {
  console.error('package.json has no version')
  process.exit(1)
}

let changed = false
for (const relative of TARGETS) {
  const manifest = readManifest(relative)
  if (manifest.version === root.version) continue
  manifest.version = root.version
  writeFileSync(join(rootDir, relative), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`${relative}: ${manifest.version}`)
  changed = true
}

console.log(changed ? `synced to ${root.version}` : `already at ${root.version}`)
