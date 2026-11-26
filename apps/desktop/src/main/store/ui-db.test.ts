import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { UiDatabase } from './ui-db'

let dir: string | null = null

function makeWritable(directory: string): void {
  for (const name of readdirSync(directory)) {
    try {
      chmodSync(join(directory, name), 0o666)
    } catch {
      // A side file may already be gone; the directory cleanup handles the rest.
    }
  }
}

afterEach(() => {
  if (!dir) return
  makeWritable(dir)
  rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('UiDatabase', () => {
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0

  /**
   * WAL's persistent sidecars can be created at a higher integrity level than the
   * Electron process that later opens them, and SQLite then refuses every write.
   * DELETE journaling has no sidecar that outlives the writer.
   */
  it('uses DELETE journaling and leaves no WAL sidecars', () => {
    dir = mkdtempSync(join(tmpdir(), 'wegram-ui-db-'))
    const file = join(dir, 'ui.db')

    const db = new UiDatabase(file)
    db.open()
    db.setSetting('theme', 'dark')
    expect(db.getJournalMode()).toBe('delete')
    db.close()

    expect(readdirSync(dir)).toEqual(['ui.db'])
  })

  /**
   * A file the OS refuses to open for writing makes SQLite open the database
   * read-only without an error: reads work, and only the first write answers
   * `attempt to write a readonly database` — the state the settings window
   * reported. The fix is a fresh connection on that error.
   */
  it.skipIf(asRoot)('reopens once and lands the write after the file is writable again', () => {
    dir = mkdtempSync(join(tmpdir(), 'wegram-ui-db-'))
    const file = join(dir, 'ui.db')

    const seed = new UiDatabase(file)
    seed.open()
    seed.setSetting('theme', 'system')
    seed.close()

    // A read-only database (and its side files, if a close left any) opens fine
    // but every write fails until the attribute goes away.
    for (const name of readdirSync(dir)) chmodSync(join(dir, name), 0o444)

    const db = new UiDatabase(file)
    db.open()
    expect(() => db.setSetting('theme', 'dark')).toThrow(/readonly/)

    // The failed write left this handle read-only too; clearing the attribute is
    // enough for the next write to reconnect and succeed without a restart.
    makeWritable(dir)
    db.setSetting('theme', 'dark')
    expect(db.getSetting('theme')).toBe('dark')
    db.close()
  })
})
