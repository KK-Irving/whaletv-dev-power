/**
 * SQLite 数据层（基于 Node.js 22.5+ 内置 `node:sqlite`，无 native 编译）。
 *
 * 三源主表 + 各自 FTS5 + sync_state，与 v1.0 设计一致。
 */

import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import { mkdirSync } from "node:fs";

import { config } from "./config.js";

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
    _db = null;
  }
}

// =============================================================================
// 迁移（幂等）
// =============================================================================

function migrate(db: DatabaseSync): void {
  db.exec(`
    -- 公共：同步水位
    CREATE TABLE IF NOT EXISTS sync_state (
      source TEXT NOT NULL,
      key    TEXT NOT NULL,
      value  TEXT NOT NULL,
      PRIMARY KEY (source, key)
    );

    -- ============ Zmind issues ============
    CREATE TABLE IF NOT EXISTS zmind_issues (
      id                  INTEGER PRIMARY KEY,
      tracker             TEXT,
      subject             TEXT,
      description         TEXT,
      status              TEXT,
      assigned_to         TEXT,
      project_id          INTEGER,
      project_name        TEXT,
      created_on          TEXT,
      updated_on          TEXT,
      embedding           BLOB,
      embedding_updated_at TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS zmind_issues_fts USING fts5(
      subject, description,
      content='zmind_issues', content_rowid='id',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS zmind_issues_ai AFTER INSERT ON zmind_issues BEGIN
      INSERT INTO zmind_issues_fts(rowid, subject, description)
      VALUES (new.id, new.subject, new.description);
    END;
    CREATE TRIGGER IF NOT EXISTS zmind_issues_ad AFTER DELETE ON zmind_issues BEGIN
      INSERT INTO zmind_issues_fts(zmind_issues_fts, rowid, subject, description)
      VALUES('delete', old.id, old.subject, old.description);
    END;
    CREATE TRIGGER IF NOT EXISTS zmind_issues_au AFTER UPDATE ON zmind_issues BEGIN
      INSERT INTO zmind_issues_fts(zmind_issues_fts, rowid, subject, description)
      VALUES('delete', old.id, old.subject, old.description);
      INSERT INTO zmind_issues_fts(rowid, subject, description)
      VALUES (new.id, new.subject, new.description);
    END;

    -- ============ Gerrit changes ============
    CREATE TABLE IF NOT EXISTS gerrit_changes (
      change_id           TEXT PRIMARY KEY,
      number              INTEGER,
      project             TEXT,
      branch              TEXT,
      subject             TEXT,
      commit_message      TEXT,
      owner_name          TEXT,
      status              TEXT,
      created             TEXT,
      updated             TEXT,
      embedding           BLOB,
      embedding_updated_at TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS gerrit_changes_fts USING fts5(
      subject, commit_message,
      content='gerrit_changes', content_rowid='rowid',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS gerrit_changes_ai AFTER INSERT ON gerrit_changes BEGIN
      INSERT INTO gerrit_changes_fts(rowid, subject, commit_message)
      VALUES (new.rowid, new.subject, new.commit_message);
    END;
    CREATE TRIGGER IF NOT EXISTS gerrit_changes_ad AFTER DELETE ON gerrit_changes BEGIN
      INSERT INTO gerrit_changes_fts(gerrit_changes_fts, rowid, subject, commit_message)
      VALUES('delete', old.rowid, old.subject, old.commit_message);
    END;
    CREATE TRIGGER IF NOT EXISTS gerrit_changes_au AFTER UPDATE ON gerrit_changes BEGIN
      INSERT INTO gerrit_changes_fts(gerrit_changes_fts, rowid, subject, commit_message)
      VALUES('delete', old.rowid, old.subject, old.commit_message);
      INSERT INTO gerrit_changes_fts(rowid, subject, commit_message)
      VALUES (new.rowid, new.subject, new.commit_message);
    END;

    -- ============ Confluence pages ============
    CREATE TABLE IF NOT EXISTS confluence_pages (
      id                  TEXT PRIMARY KEY,
      space_key           TEXT,
      title               TEXT,
      body_text           TEXT,
      version             INTEGER,
      webui               TEXT,
      created             TEXT,
      updated             TEXT,
      embedding           BLOB,
      embedding_updated_at TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS confluence_pages_fts USING fts5(
      title, body_text,
      content='confluence_pages', content_rowid='rowid',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS confluence_pages_ai AFTER INSERT ON confluence_pages BEGIN
      INSERT INTO confluence_pages_fts(rowid, title, body_text)
      VALUES (new.rowid, new.title, new.body_text);
    END;
    CREATE TRIGGER IF NOT EXISTS confluence_pages_ad AFTER DELETE ON confluence_pages BEGIN
      INSERT INTO confluence_pages_fts(confluence_pages_fts, rowid, title, body_text)
      VALUES('delete', old.rowid, old.title, old.body_text);
    END;
    CREATE TRIGGER IF NOT EXISTS confluence_pages_au AFTER UPDATE ON confluence_pages BEGIN
      INSERT INTO confluence_pages_fts(confluence_pages_fts, rowid, title, body_text)
      VALUES('delete', old.rowid, old.title, old.body_text);
      INSERT INTO confluence_pages_fts(rowid, title, body_text)
      VALUES (new.rowid, new.title, new.body_text);
    END;

    -- ============ AOSP 代码 chunks (P2) ============
    CREATE TABLE IF NOT EXISTS aosp_chunks (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      platform            TEXT NOT NULL,
      module              TEXT NOT NULL,
      module_path         TEXT NOT NULL,
      file_path           TEXT NOT NULL,
      line_start          INTEGER NOT NULL,
      line_end            INTEGER NOT NULL,
      symbol_kind         TEXT,
      symbol_name         TEXT,
      content             TEXT NOT NULL,
      content_hash        TEXT,
      embedding           BLOB,
      embedding_updated_at TEXT,
      indexed_at          TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(platform, module, file_path, line_start, line_end)
    );

    CREATE INDEX IF NOT EXISTS idx_aosp_pm ON aosp_chunks(platform, module);
    CREATE INDEX IF NOT EXISTS idx_aosp_pmp ON aosp_chunks(platform, module_path);
    CREATE INDEX IF NOT EXISTS idx_aosp_file ON aosp_chunks(file_path);

    CREATE VIRTUAL TABLE IF NOT EXISTS aosp_chunks_fts USING fts5(
      content,
      content='aosp_chunks', content_rowid='id',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS aosp_chunks_ai AFTER INSERT ON aosp_chunks BEGIN
      INSERT INTO aosp_chunks_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS aosp_chunks_ad AFTER DELETE ON aosp_chunks BEGIN
      INSERT INTO aosp_chunks_fts(aosp_chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS aosp_chunks_au AFTER UPDATE ON aosp_chunks BEGIN
      INSERT INTO aosp_chunks_fts(aosp_chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO aosp_chunks_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);
}

// =============================================================================
// 事务封装（node:sqlite 没有 better-sqlite3 的 transaction() helper）
// =============================================================================

export function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

// =============================================================================
// sync_state 帮手
// =============================================================================

export function getSyncState(source: string, key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM sync_state WHERE source = ? AND key = ?")
    .get(source, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSyncState(source: string, key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO sync_state(source, key, value) VALUES (?, ?, ?) ON CONFLICT(source, key) DO UPDATE SET value = excluded.value",
    )
    .run(source, key, value);
}

// =============================================================================
// Helpers：序列化 / 反序列化向量
// =============================================================================

export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function blobToVector(blob: Buffer | Uint8Array, dim: number): Float32Array {
  const ab = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  const f32 = new Float32Array(ab);
  if (f32.length !== dim) {
    throw new Error(`embedding dim mismatch: expected ${dim}, got ${f32.length}`);
  }
  return f32;
}
