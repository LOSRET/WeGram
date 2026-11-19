#!/usr/bin/env node
/**
 * Fail when a workspace manifest disagrees with the root package.json version.
 *
 * Runs as the first step of `pnpm verify`, so a half-finished version bump
 * cannot reach `main` — the release workflow stamps the tag into the root
 * manifest and then syncs, which keeps the two mechanisms compatible.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = [
  'apps/desktop/package.json',
  'packages/protocol/package.json',
  'packages/mock-session/package.json',
  'packages/mock-fixtures/package.json',
]

const readManifest = (relative) =>
  JSON.parse(readFileSync(join(rootDir, relative), 'utf8'))

const expected = readManifest('package.json').version
const offenders = TARGETS.map((relative) => ({ relative, version: readManifest(relative).version }))
  .filter((entry) => entry.version !== expected)

if (offenders.length > 0) {
  console.error(`version drift: root is ${expected}`)
  for (const entry of offenders) console.error(`  ${entry.relative}: ${entry.version}`)
  console.error('run: pnpm sync-version')
  process.exit(1)
}

console.log(`version ${expected} is in sync`)
