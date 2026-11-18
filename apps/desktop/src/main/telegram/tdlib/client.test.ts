import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveTdjsonPath } from './client'

/** A packaged layout: app.asar next to app.asar.unpacked, both as directories. */
function packagedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'wegram-tdjson-'))
  mkdirSync(join(root, 'app.asar', 'node_modules'), { recursive: true })
  mkdirSync(join(root, 'app.asar.unpacked', 'node_modules'), { recursive: true })
  return root
}

describe('resolveTdjsonPath', () => {
  it('moves an asar path to the unpacked copy electron-builder ships', () => {
    const root = packagedRoot()
    const inside = join(root, 'app.asar', 'node_modules', 'tdjson.dll')
    writeFileSync(inside, '')
    writeFileSync(join(root, 'app.asar.unpacked', 'node_modules', 'tdjson.dll'), '')
    expect(resolveTdjsonPath(inside)).toBe(
      join(root, 'app.asar.unpacked', 'node_modules', 'tdjson.dll'),
    )
  })

  it('leaves the path alone when no unpacked copy exists', () => {
    const root = packagedRoot()
    const inside = join(root, 'app.asar', 'node_modules', 'tdjson.dll')
    expect(resolveTdjsonPath(inside)).toBe(inside)
  })

  it('leaves a development path untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'wegram-tdjson-dev-'))
    const inside = join(root, 'node_modules', '@prebuilt-tdlib', 'win32-x64', 'tdjson.dll')
    expect(resolveTdjsonPath(inside)).toBe(inside)
  })

  it('is idempotent for an already unpacked path', () => {
    const root = packagedRoot()
    const unpacked = join(root, 'app.asar.unpacked', 'node_modules', 'tdjson.dll')
    writeFileSync(unpacked, '')
    expect(resolveTdjsonPath(unpacked)).toBe(unpacked)
  })
})
