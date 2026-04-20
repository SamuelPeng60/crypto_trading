import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DB_DIR, 'trading.db')

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })

declare global {
  var __db: Database.Database | undefined
}

// Module-level flag — resets on every hot reload, so migrate() re-runs
// when globalThis.__db is stale (common in Next.js dev mode)
let _migrated = false

export function getDb(): Database.Database {
  if (!globalThis.__db) {
    const db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initSchema(db)
    globalThis.__db = db
    _migrated = false
  }
  if (!_migrated) {
    migrate(globalThis.__db)
    _migrated = true
  }
  return globalThis.__db
}

function migrate(db: Database.Database) {
  // Migration 1: Add session_id column (idempotent)
  try { db.exec('ALTER TABLE strategies ADD COLUMN session_id TEXT') } catch { /* already exists */ }

  // Migration 3: Add last_signal column for entry-transition guard
  try { db.exec("ALTER TABLE strategies ADD COLUMN last_signal TEXT NOT NULL DEFAULT 'hold'") } catch { /* already exists */ }

  // Migration 4: Add mode column (paper | live) per strategy
  try { db.exec("ALTER TABLE strategies ADD COLUMN mode TEXT NOT NULL DEFAULT 'paper'") } catch { /* already exists */ }

  // Migration 2: Expand type CHECK constraint to include new strategy types
  // Uses separate exec() calls — no PRAGMA needed (SQLite DDL ignores FK checks)
  try {
    const row = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='strategies'"
    ).get() as { sql: string } | undefined

    if (row && !row.sql.includes('ema_ribbon_st')) {
      // Ensure session_id exists before copying (safe no-op if already present)
      try { db.exec('ALTER TABLE strategies ADD COLUMN session_id TEXT') } catch {}

      db.exec(`CREATE TABLE strategies_v2 (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL CHECK(type IN ('ma_cross','rsi','grid','supertrend','vwap_bb_rsi','ema_ribbon_st','macd_bb_squeeze')),
        symbol      TEXT NOT NULL,
        params      TEXT NOT NULL,
        is_active   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        session_id  TEXT
      )`)
      db.exec(`INSERT INTO strategies_v2
        SELECT id, name, type, symbol, params, is_active, created_at, updated_at, session_id
        FROM strategies`)
      db.exec(`DROP TABLE strategies`)
      db.exec(`ALTER TABLE strategies_v2 RENAME TO strategies`)
    }
  } catch (e) {
    console.error('[db] migration 2 failed:', e)
    // Clean up partial migration if strategies_v2 was created
    try { db.exec('DROP TABLE IF EXISTS strategies_v2') } catch {}
  }

  // Migration 5: Add adaptive_combo type
  try {
    const row = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='strategies'"
    ).get() as { sql: string } | undefined

    if (row && !row.sql.includes('adaptive_combo')) {
      try { db.exec('ALTER TABLE strategies ADD COLUMN session_id TEXT') } catch {}
      try { db.exec("ALTER TABLE strategies ADD COLUMN last_signal TEXT NOT NULL DEFAULT 'hold'") } catch {}
      try { db.exec("ALTER TABLE strategies ADD COLUMN mode TEXT NOT NULL DEFAULT 'paper'") } catch {}
      // Disable FK checks temporarily so DROP TABLE strategies succeeds
      // even when orders/positions/logs reference it
      db.pragma('foreign_keys = OFF')
      try {
        db.exec(`CREATE TABLE strategies_v3 (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL,
          type        TEXT NOT NULL CHECK(type IN ('ma_cross','rsi','grid','supertrend','vwap_bb_rsi','ema_ribbon_st','macd_bb_squeeze','adaptive_combo')),
          symbol      TEXT NOT NULL,
          params      TEXT NOT NULL,
          is_active   INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
          session_id  TEXT,
          last_signal TEXT NOT NULL DEFAULT 'hold',
          mode        TEXT NOT NULL DEFAULT 'paper'
        )`)
        db.exec(`INSERT INTO strategies_v3 SELECT id, name, type, symbol, params, is_active, created_at, updated_at, session_id, last_signal, mode FROM strategies`)
        db.exec(`DROP TABLE strategies`)
        db.exec(`ALTER TABLE strategies_v3 RENAME TO strategies`)
      } finally {
        db.pragma('foreign_keys = ON')
      }
    }
  } catch (e) {
    console.error('[db] migration 5 failed:', e)
    try { db.exec('DROP TABLE IF EXISTS strategies_v3') } catch {}
  }

  // Migration 6: Create participants table (for existing databases)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS participants (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      investment  REAL NOT NULL DEFAULT 0,
      start_date  TEXT NOT NULL,
      current_pnl REAL NOT NULL DEFAULT 0,
      note        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  } catch { /* already exists */ }

  // Migration 7: Add strategy session binding to participants
  try { db.exec('ALTER TABLE participants ADD COLUMN bound_session_id TEXT') } catch { /* already exists */ }
  try { db.exec('ALTER TABLE participants ADD COLUMN allocated REAL NOT NULL DEFAULT 0') } catch { /* already exists */ }

  // Migration 8: Auth — users + user_sessions tables
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    db.exec(`CREATE TABLE IF NOT EXISTS user_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  } catch { /* already exists */ }

  // Migration 9: Archive support
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS archives (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      notes        TEXT,
      period_start TEXT,
      period_end   TEXT,
      total_pnl    REAL,
      total_trades INTEGER,
      win_rate     REAL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  } catch { /* already exists */ }
  try { db.exec('ALTER TABLE orders ADD COLUMN archive_id INTEGER REFERENCES archives(id)') } catch { /* already exists */ }
  try { db.exec('ALTER TABLE positions ADD COLUMN archive_id INTEGER REFERENCES archives(id)') } catch { /* already exists */ }
  try { db.exec('ALTER TABLE positions ADD COLUMN trail_high REAL') } catch { /* already exists */ }
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS participants (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      investment        REAL NOT NULL DEFAULT 0,
      start_date        TEXT NOT NULL,
      current_pnl       REAL NOT NULL DEFAULT 0,
      note              TEXT,
      bound_session_id  TEXT,
      allocated         REAL NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategies (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('ma_cross','rsi','grid','supertrend','vwap_bb_rsi','ema_ribbon_st','macd_bb_squeeze','adaptive_combo')),
      symbol      TEXT NOT NULL,
      params      TEXT NOT NULL,   -- JSON
      is_active   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      session_id  TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id   INTEGER REFERENCES strategies(id),
      exchange_id   TEXT,
      symbol        TEXT NOT NULL,
      side          TEXT NOT NULL CHECK(side IN ('buy','sell')),
      order_type    TEXT NOT NULL DEFAULT 'market',
      price         REAL,
      quantity      REAL NOT NULL,
      filled_price  REAL,
      status        TEXT NOT NULL DEFAULT 'pending',
      pnl           REAL,
      fee           REAL,
      mode          TEXT NOT NULL DEFAULT 'paper',  -- paper | live
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at     TEXT
    );

    CREATE TABLE IF NOT EXISTS positions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id  INTEGER REFERENCES strategies(id),
      symbol       TEXT NOT NULL,
      side         TEXT NOT NULL CHECK(side IN ('long','short')),
      entry_price  REAL NOT NULL,
      quantity     REAL NOT NULL,
      current_price REAL,
      unrealized_pnl REAL,
      mode         TEXT NOT NULL DEFAULT 'paper',
      opened_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(strategy_id, symbol, mode)
    );

    CREATE TABLE IF NOT EXISTS strategy_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER REFERENCES strategies(id),
      level       TEXT NOT NULL DEFAULT 'info',
      message     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS backtest_results (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id   INTEGER REFERENCES strategies(id),
      symbol        TEXT NOT NULL,
      interval      TEXT NOT NULL,
      start_date    TEXT NOT NULL,
      end_date      TEXT NOT NULL,
      initial_capital REAL NOT NULL,
      final_capital   REAL NOT NULL,
      total_return    REAL NOT NULL,
      max_drawdown    REAL NOT NULL,
      win_rate        REAL NOT NULL,
      total_trades    INTEGER NOT NULL,
      sharpe_ratio    REAL,
      trades_json     TEXT NOT NULL,  -- JSON array of trades
      equity_json     TEXT NOT NULL,  -- JSON array of {time, value}
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}
