import { getDatabase } from '../index.js'

/**
 * 读取一个应用设置。
 * key 是设置名；value_json 存的是 JSON 字符串；解析失败时返回 fallbackValue。
 */
export async function getSetting(key, fallbackValue = null) {
  const db = await getDatabase()
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(String(key))

  if (!row) {
    return fallbackValue
  }

  try {
    return JSON.parse(row.value_json)
  } catch {
    return fallbackValue
  }
}

/**
 * 写入一个应用设置。
 * 任意可 JSON 序列化的 value 都会保存到 app_settings.value_json。
 */
export async function setSetting(key, value) {
  const db = await getDatabase()
  const now = new Date().toISOString()

  db.prepare(
    `
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `,
  ).run(String(key), JSON.stringify(value), now)

  return {
    key: String(key),
    value,
    updatedAt: now,
  }
}
