import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { createLogger } from '../util'

export interface DraftRecord {
  text: string
  replyTo?: number
}

const logger = createLogger('ui-db')

/**
 * UI database (`ui.db`, design doc §5.1/§5.2).
 *
 * Uses the built-in `node:sqlite` instead of better-sqlite3: it ships with
 * Electron's Node (22.22) so there is no native module to rebuild for the
 * Electron ABI. It is flagged experimental upstream, so the schema access is
 * confined to this file — swapping in better-sqlite3 later touches nothing else.
 *
 * Message data is NOT stored here: TDLib owns it (§5.1).
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY,
  phone         TEXT,
  first_name    TEXT,
  last_name     TEXT,
  username      TEXT,
  is_active     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_ui_state (
  chat_id          INTEGER PRIMARY KEY,
  draft_text       TEXT,
  draft_entities   TEXT,
  draft_reply_to   INTEGER,
  scroll_anchor_id INTEGER,
  scroll_offset    INTEGER,
  last_painted_at  INTEGER
);

CREATE TABLE IF NOT EXISTS app_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_cache (
  file_id      INTEGER PRIMARY KEY,
  remote_id    TEXT UNIQUE,
  local_path   TEXT,
  size         INTEGER,
  last_used_at INTEGER,
  pinned       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_media_lru ON media_cache(pinned, last_used_at);
`

export class UiDatabase {
  private db: DatabaseSync | null = null

  constructor(private readonly file: string) {}

  open(): void {
    if (this.db) return
    mkdirSync(dirname(this.file), { recursive: true })
    const db = new DatabaseSync(this.file)
    db.exec(SCHEMA)
    this.db = db
    logger.info(`opened ${this.file}`)
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  getDraft(chatId: number): DraftRecord | null {
    const row = this.require()
      .prepare('SELECT draft_text, draft_reply_to FROM chat_ui_state WHERE chat_id = ?')
      .get(chatId) as { draft_text: string | null; draft_reply_to: number | null } | undefined

    if (!row?.draft_text) return null
    return {
      text: row.draft_text,
      ...(row.draft_reply_to == null ? {} : { replyTo: Number(row.draft_reply_to) }),
    }
  }

  saveDraft(chatId: number, draft: DraftRecord | null): void {
    const db = this.require()
    if (!draft || draft.text.trim().length === 0) {
      db.prepare(
        `INSERT INTO chat_ui_state (chat_id, draft_text, draft_reply_to, last_painted_at)
         VALUES (?, NULL, NULL, ?)
         ON CONFLICT(chat_id) DO UPDATE SET draft_text = NULL, draft_reply_to = NULL, last_painted_at = excluded.last_painted_at`,
      ).run(chatId, Date.now())
      return
    }

    db.prepare(
      `INSERT INTO chat_ui_state (chat_id, draft_text, draft_reply_to, last_painted_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         draft_text = excluded.draft_text,
         draft_reply_to = excluded.draft_reply_to,
         last_painted_at = excluded.last_painted_at`,
    ).run(chatId, draft.text, draft.replyTo ?? null, Date.now())
  }

  getSetting(key: string): string | null {
    const row = this.require().prepare('SELECT v FROM app_settings WHERE k = ?').get(key) as
      | { v: string }
      | undefined
    return row?.v ?? null
  }

  setSetting(key: string, value: string): void {
    this.require()
      .prepare(
        `INSERT INTO app_settings (k, v) VALUES (?, ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      )
      .run(key, value)
  }

  /**
   * Reserved for W3: remembering where the reader stopped in a chat.
   * Written by the UI, read back when the chat is opened again.
   */
  saveScrollAnchor(chatId: number, messageId: number | null, offset = 0): void {
    this.require()
      .prepare(
        `INSERT INTO chat_ui_state (chat_id, scroll_anchor_id, scroll_offset, last_painted_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
           scroll_anchor_id = excluded.scroll_anchor_id,
           scroll_offset = excluded.scroll_offset,
           last_painted_at = excluded.last_painted_at`,
      )
      .run(chatId, messageId, offset, Date.now())
  }

  getScrollAnchor(chatId: number): { messageId: number; offset: number } | null {
    const row = this.require()
      .prepare('SELECT scroll_anchor_id, scroll_offset FROM chat_ui_state WHERE chat_id = ?')
      .get(chatId) as { scroll_anchor_id: number | null; scroll_offset: number | null } | undefined
    if (row?.scroll_anchor_id == null) return null
    return { messageId: Number(row.scroll_anchor_id), offset: Number(row.scroll_offset ?? 0) }
  }

  private require(): DatabaseSync {
    if (!this.db) throw new Error('ui.db is not open')
    return this.db
  }
}
