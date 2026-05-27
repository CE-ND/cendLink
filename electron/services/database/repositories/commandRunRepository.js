import { randomUUID } from 'node:crypto'
import { getDatabase } from '../index.js'

// stdout/stderr 在列表页只保存预览文本，完整日志以后可以落到 log_file_path。
const PREVIEW_LIMIT = 4000

/**
 * 记录一次远程命令执行结果。
 */
export async function recordCommandRun(input = {}) {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const normalized = normalizeCommandRunInput(input, now)

  db.prepare(
    `
      INSERT INTO command_runs (
        id,
        server_id,
        server_name,
        host,
        port,
        username,
        command,
        status,
        exit_code,
        duration_ms,
        stdout_preview,
        stderr_preview,
        log_file_path,
        started_at,
        finished_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    normalized.id,
    normalized.serverId,
    normalized.serverName,
    normalized.host,
    normalized.port,
    normalized.username,
    normalized.command,
    normalized.status,
    normalized.exitCode,
    normalized.durationMs,
    normalized.stdoutPreview,
    normalized.stderrPreview,
    normalized.logFilePath,
    normalized.startedAt,
    normalized.finishedAt,
    normalized.createdAt,
  )

  return getCommandRun(normalized.id)
}

/**
 * 按时间倒序读取命令执行记录。
 * limit 会限制在 1-500 之间，避免一次性加载过多历史。
 */
export async function listCommandRuns(limit = 100) {
  const db = await getDatabase()
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500))
  const rows = db
    .prepare(
      `
        SELECT *
        FROM command_runs
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(safeLimit)

  return rows.map(mapCommandRunRow)
}

/**
 * 按 id 获取单条命令执行记录。
 */
export async function getCommandRun(id) {
  const db = await getDatabase()
  const row = db.prepare('SELECT * FROM command_runs WHERE id = ?').get(String(id || ''))

  return row ? mapCommandRunRow(row) : null
}

/**
 * 校验并整理命令执行记录。
 * 返回字段说明：
 * - serverId/serverName/host/port/username：命令运行时对应的服务器快照。
 * - command：实际执行的 Linux 命令。
 * - status/exitCode/durationMs：执行状态、退出码和耗时。
 * - stdoutPreview/stderrPreview：输出预览，超长会截断。
 * - logFilePath：后续保存完整日志文件时使用。
 * - startedAt/finishedAt/createdAt：执行开始、结束和记录创建时间。
 */
function normalizeCommandRunInput(input, now) {
  const command = String(input.command || '').trim()
  const durationMs = Number(input.durationMs || 0)
  const finishedAt = input.finishedAt ? String(input.finishedAt) : now
  const startedAt = input.startedAt
    ? String(input.startedAt)
    : new Date(Date.parse(finishedAt) - Math.max(durationMs, 0)).toISOString()

  if (!command) {
    throw new Error('命令记录缺少 command')
  }

  return {
    id: String(input.id || '').trim() || randomUUID(),
    serverId: input.serverId ? String(input.serverId) : null,
    serverName: String(input.serverName || ''),
    host: String(input.host || ''),
    port: Number(input.port || 22),
    username: String(input.username || ''),
    command,
    status: String(input.status || 'unknown'),
    exitCode: Number.isInteger(input.exitCode) ? input.exitCode : null,
    durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    stdoutPreview: trimPreview(input.stdout || input.stdoutPreview || ''),
    stderrPreview: trimPreview(input.stderr || input.stderrPreview || ''),
    logFilePath: String(input.logFilePath || ''),
    startedAt,
    finishedAt,
    createdAt: now,
  }
}

/**
 * 截断过长输出，只保留列表展示需要的预览。
 */
function trimPreview(value) {
  const text = String(value || '')

  if (text.length <= PREVIEW_LIMIT) {
    return text
  }

  return `${text.slice(0, PREVIEW_LIMIT)}\n[preview truncated]`
}

/**
 * 把 SQLite 的 snake_case 行转换成前端 camelCase 对象。
 */
function mapCommandRunRow(row) {
  return {
    id: row.id,
    serverId: row.server_id,
    serverName: row.server_name,
    host: row.host,
    port: row.port,
    username: row.username,
    command: row.command,
    status: row.status,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
    stdoutPreview: row.stdout_preview,
    stderrPreview: row.stderr_preview,
    logFilePath: row.log_file_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  }
}
