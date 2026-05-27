import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dbPath, ensureStorageDirectories, getStorageInfo } from './paths.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const migrationsDir = path.join(__dirname, 'migrations')

// SQLite 单例连接。主进程内复用一条连接，避免重复初始化和重复迁移。
let database = null

/**
 * 初始化本地 SQLite 数据库。
 * 功能：
 * - 创建 ~/.cendLink 目录结构。
 * - 打开 cendlink.db。
 * - 开启外键、WAL 和 busy_timeout。
 * - 执行尚未应用的 SQL 迁移。
 */
export async function initializeDatabase() {
  if (database) {
    return database
  }

  await ensureStorageDirectories()

  database = new DatabaseSync(dbPath)
  database.exec('PRAGMA foreign_keys = ON;')
  database.exec('PRAGMA journal_mode = WAL;')
  database.exec('PRAGMA busy_timeout = 5000;')

  await runMigrations(database)

  return database
}

/**
 * 获取数据库连接；调用方不用关心数据库是否已经初始化。
 */
export async function getDatabase() {
  return initializeDatabase()
}

/**
 * 返回数据库和日志目录信息，调用前会确保数据库已初始化。
 */
export async function getDatabaseStorageInfo() {
  await initializeDatabase()
  return getStorageInfo()
}

/**
 * 执行 migrations 目录下尚未应用的 .sql 文件。
 * schema_migrations 记录每个迁移文件是否已经执行，避免重复 ALTER/CREATE。
 */
async function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const migrationFiles = (await fs.readdir(migrationsDir))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()

  for (const fileName of migrationFiles) {
    const migrationId = fileName.replace(/\.sql$/, '')
    const existing = db
      .prepare('SELECT id FROM schema_migrations WHERE id = ?')
      .get(migrationId)

    if (existing) {
      continue
    }

    const sql = await fs.readFile(path.join(migrationsDir, fileName), 'utf8')

    db.exec('BEGIN;')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        migrationId,
        new Date().toISOString(),
      )
      db.exec('COMMIT;')
    } catch (error) {
      db.exec('ROLLBACK;')
      throw error
    }
  }
}
