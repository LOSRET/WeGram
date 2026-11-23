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
 * Electron's Node (24.22) so there is no native module to rebuild for the
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

-- One reading position per comment thread (§9.8). The key is the *commented*
-- message, because a chat's own anchor must stay untouched, and one channel can
-- hold many open threads. Missing row = the reader never scrolled: the panel
-- opens at the top of the thread.
CREATE TABLE IF NOT EXISTS comment_ui_state (
  chat_id          INTEGER NOT NULL,
  message_id       INTEGER NOT NULL,
  anchor_id        INTEGER NOT NULL,
  anchor_offset    INTEGER NOT NULL DEFAULT 0,
  last_painted_at  INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);

-- 话题 (design doc §9.12): one draft and one reading position per topic, the
-- same shape as chat_ui_state. A forum never uses the chat row, and a chat
-- converted to a forum keeps it for the flat "view as chats" mode. A separate
-- table rather than an extra column, because SQLite cannot widen a primary key
-- in place.
CREATE TABLE IF NOT EXISTS topic_ui_state (
  chat_id          INTEGER NOT NULL,
  topic_id         INTEGER NOT NULL,
  draft_text       TEXT,
  draft_reply_to   INTEGER,
  scroll_anchor_id INTEGER,
  scroll_offset    INTEGER,
  last_painted_at  INTEGER,
  PRIMARY KEY (chat_id, topic_id)
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

  /** 话题内草稿: the same record as a chat's, keyed by (chat, topic). */
  getTopicDraft(chatId: number, topicId: number): DraftRecord | null {
    const row = this.require()
      .prepare(
        'SELECT draft_text, draft_reply_to FROM topic_ui_state WHERE chat_id = ? AND topic_id = ?',
      )
      .get(chatId, topicId) as
      { draft_text: string | null; draft_reply_to: number | null } | undefined

    if (!row?.draft_text) return null
    return {
      text: row.draft_text,
      ...(row.draft_reply_to == null ? {} : { replyTo: Number(row.draft_reply_to) }),
    }
  }

  saveTopicDraft(chatId: number, topicId: number, draft: DraftRecord | null): void {
    const db = this.require()
    if (!draft || draft.text.trim().length === 0) {
      db.prepare(
        `INSERT INTO topic_ui_state (chat_id, topic_id, draft_text, draft_reply_to, last_painted_at)
         VALUES (?, ?, NULL, NULL, ?)
         ON CONFLICT(chat_id, topic_id) DO UPDATE SET
           draft_text = NULL, draft_reply_to = NULL, last_painted_at = excluded.last_painted_at`,
      ).run(chatId, topicId, Date.now())
      return
    }

    db.prepare(
      `INSERT INTO topic_ui_state (chat_id, topic_id, draft_text, draft_reply_to, last_painted_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, topic_id) DO UPDATE SET
         draft_text = excluded.draft_text,
         draft_reply_to = excluded.draft_reply_to,
         last_painted_at = excluded.last_painted_at`,
    ).run(chatId, topicId, draft.text, draft.replyTo ?? null, Date.now())
  }

  /** 话题内阅读位置; `messageId: null` means "the reader was at the bottom". */
  saveTopicAnchor(chatId: number, topicId: number, messageId: number | null, offset = 0): void {
    this.require()
      .prepare(
        `INSERT INTO topic_ui_state (chat_id, topic_id, scroll_anchor_id, scroll_offset, last_painted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, topic_id) DO UPDATE SET
           scroll_anchor_id = excluded.scroll_anchor_id,
           scroll_offset = excluded.scroll_offset,
           last_painted_at = excluded.last_painted_at`,
      )
      .run(chatId, topicId, messageId, offset, Date.now())
  }

  getTopicAnchor(chatId: number, topicId: number): { messageId: number; offset: number } | null {
    const row = this.require()
      .prepare(
        'SELECT scroll_anchor_id, scroll_offset FROM topic_ui_state WHERE chat_id = ? AND topic_id = ?',
      )
      .get(chatId, topicId) as
      { scroll_anchor_id: number | null; scroll_offset: number | null } | undefined
    if (row?.scroll_anchor_id == null) return null
    return { messageId: Number(row.scroll_anchor_id), offset: Number(row.scroll_offset ?? 0) }
  }

  getSetting(key: string): string | null {
    const row = this.require().prepare('SELECT v FROM app_settings WHERE k = ?').get(key) as
      { v: string } | undefined
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
   * Reading position of a chat (§8.2 rule 5). Written by MessageList after the
   * reader scrolls, read back by ChatPane when the chat is opened.
   *
   * `messageId: null` is meaningful: it means "the reader was at the bottom" and
   * is what makes reopening the chat land on the newest message.
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

  /**
   * Reading position inside one message's comment thread (§9.8). Keyed by the
   * commented message: the same chat can have many threads, and a channel's own
   * scroll position is a different row in `chat_ui_state`.
   *
   * No row at all is the default: the discussion view opens at its top.
   */
  saveCommentAnchor(chatId: number, messageId: number, anchorId: number, offset = 0): void {
    this.require()
      .prepare(
        `INSERT INTO comment_ui_state (chat_id, message_id, anchor_id, anchor_offset, last_painted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, message_id) DO UPDATE SET
           anchor_id = excluded.anchor_id,
           anchor_offset = excluded.anchor_offset,
           last_painted_at = excluded.last_painted_at`,
      )
      .run(chatId, messageId, anchorId, offset, Date.now())
  }

  getCommentAnchor(
    chatId: number,
    messageId: number,
  ): { messageId: number; offset: number } | null {
    const row = this.require()
      .prepare(
        'SELECT anchor_id, anchor_offset FROM comment_ui_state WHERE chat_id = ? AND message_id = ?',
      )
      .get(chatId, messageId) as { anchor_id: number; anchor_offset: number | null } | undefined
    if (row == null) return null
    return { messageId: Number(row.anchor_id), offset: Number(row.anchor_offset ?? 0) }
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
