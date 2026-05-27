import { randomUUID } from 'node:crypto'
import { getDatabase } from '../index.js'

/**
 * 读取所有服务器配置，按最近更新时间倒序返回。
 */
export async function listServers() {
  const db = await getDatabase()
  const rows = db
    .prepare(
      `
        SELECT *
        FROM servers
        ORDER BY updated_at DESC
      `,
    )
    .all()

  return rows.map(mapServerRow)
}

/**
 * 新增或更新服务器配置。
 * input 字段来自前端表单和 IPC 预处理结果，password_secret 已在入库前加密完成。
 */
export async function saveServer(input = {}) {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const normalized = normalizeServerInput(input, now)

  db.prepare(
    `
      INSERT INTO servers (
        id,
        name,
        host,
        port,
        username,
        auth_type,
        private_key_path,
        remember_password,
        password_secret,
        timeout_ms,
        last_status,
        last_message,
        last_connected_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        host = excluded.host,
        port = excluded.port,
        username = excluded.username,
        auth_type = excluded.auth_type,
        private_key_path = excluded.private_key_path,
        remember_password = excluded.remember_password,
        password_secret = excluded.password_secret,
        timeout_ms = excluded.timeout_ms,
        last_status = excluded.last_status,
        last_message = excluded.last_message,
        last_connected_at = excluded.last_connected_at,
        updated_at = excluded.updated_at
    `,
  ).run(
    normalized.id,
    normalized.name,
    normalized.host,
    normalized.port,
    normalized.username,
    normalized.authType,
    normalized.privateKeyPath,
    normalized.rememberPassword ? 1 : 0,
    normalized.passwordSecret,
    normalized.timeoutMs,
    normalized.lastStatus,
    normalized.lastMessage,
    normalized.lastConnectedAt,
    normalized.createdAt,
    normalized.updatedAt,
  )

  return getServer(normalized.id)
}

/**
 * 按 id 获取单个服务器配置。
 */
export async function getServer(id) {
  const db = await getDatabase()
  const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(String(id || ''))

  return row ? mapServerRow(row) : null
}

/**
 * 删除一个服务器配置。
 */
export async function deleteServer(id) {
  const db = await getDatabase()
  const result = db.prepare('DELETE FROM servers WHERE id = ?').run(String(id || ''))

  return {
    deleted: result.changes > 0,
  }
}

/**
 * 校验并整理服务器配置。
 * 返回字段说明：
 * - id：服务器配置主键，新建时自动生成 UUID。
 * - name/host/port/username：连接展示名和 SSH 目标信息。
 * - authType：password 或 privateKey。
 * - privateKeyPath：私钥文件路径，仅私钥模式保存路径，不保存文件内容。
 * - rememberPassword：用户是否允许保存密码。
 * - passwordSecret：加密后的密码密文，未勾选记住密码时为空。
 * - timeoutMs：SSH 连接超时时间。
 * - lastStatus/lastMessage/lastConnectedAt：最近一次连接测试状态。
 * - createdAt/updatedAt：创建和更新时间。
 */
function normalizeServerInput(input, now) {
  const name = String(input.name || '').trim() || '未命名服务器'
  const host = String(input.host || '').trim()
  const username = String(input.username || '').trim()
  const authType = String(input.authType || 'password')
  const port = Number(input.port || 22)
  const timeoutMs = Number(input.timeoutMs || 10000)

  if (!host) {
    throw new Error('保存服务器前请填写 Host')
  }

  if (!username) {
    throw new Error('保存服务器前请填写用户名')
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('端口必须是 1 到 65535 之间的整数')
  }

  if (authType !== 'password' && authType !== 'privateKey') {
    throw new Error('认证方式不正确')
  }

  return {
    id: String(input.id || '').trim() || randomUUID(),
    name,
    host,
    port,
    username,
    authType,
    privateKeyPath: authType === 'privateKey' ? String(input.privateKeyPath || '').trim() : '',
    rememberPassword: Boolean(input.rememberPassword),
    passwordSecret: String(input.passwordSecret || ''),
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 10000,
    lastStatus: String(input.lastStatus || 'idle'),
    lastMessage: String(input.lastMessage || ''),
    lastConnectedAt: input.lastConnectedAt ? String(input.lastConnectedAt) : null,
    createdAt: input.createdAt ? String(input.createdAt) : now,
    updatedAt: now,
  }
}

/**
 * 把 SQLite 的 snake_case 行转换成前端更习惯的 camelCase 对象。
 */
function mapServerRow(row) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    privateKeyPath: row.private_key_path,
    rememberPassword: Boolean(row.remember_password),
    passwordSecret: row.password_secret || '',
    timeoutMs: row.timeout_ms,
    lastStatus: row.last_status,
    lastMessage: row.last_message,
    lastConnectedAt: row.last_connected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
