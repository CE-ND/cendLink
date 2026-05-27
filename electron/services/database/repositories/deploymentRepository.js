import { randomUUID } from 'node:crypto'
import { getDatabase } from '../index.js'

/**
 * 保存一次镜像包生成记录。
 * 现在 deployments 表先承载本地打包记录，后续上传/运行阶段继续扩展同一条流水。
 */
export async function recordImagePackage(input = {}) {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const normalized = normalizeImagePackageInput(input, now)

  db.prepare(
    `
      INSERT INTO deployments (
        id,
        project_id,
        server_id,
        status,
        artifact_name,
        deploy_path,
        started_at,
        finished_at,
        duration_ms,
        error_summary,
        log_file_path,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    normalized.id,
    normalized.projectId,
    normalized.serverId,
    normalized.status,
    normalized.artifactName,
    normalized.deployPath,
    normalized.startedAt,
    normalized.finishedAt,
    normalized.durationMs,
    normalized.errorSummary,
    normalized.logFilePath,
    normalized.createdAt,
    normalized.updatedAt,
  )

  recordDeploymentStep(db, normalized, now)

  return getDeployment(normalized.id)
}

/**
 * 按时间倒序读取部署/打包记录。
 */
export async function listDeployments(limit = 100) {
  const db = await getDatabase()
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500))
  const rows = db
    .prepare(
      `
        SELECT *
        FROM deployments
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(safeLimit)

  return rows.map(mapDeploymentRow)
}

/**
 * 获取单条部署/打包记录。
 */
export async function getDeployment(id) {
  const db = await getDatabase()
  const row = db.prepare('SELECT * FROM deployments WHERE id = ?').get(String(id || ''))

  return row ? mapDeploymentRow(row) : null
}

function normalizeImagePackageInput(input, now) {
  const status = input.ok ? 'package_success' : 'package_failed'
  const artifactName = String(input.packageFileName || input.imageRef || input.serviceName || '')
  const deployPath = String(input.packagePath || '')
  const durationMs = Number(input.durationMs || 0)

  return {
    id: String(input.id || '').trim() || randomUUID(),
    projectId: String(input.imageRef || input.serviceName || ''),
    serverId: null,
    status,
    artifactName,
    deployPath,
    startedAt: input.startedAt ? String(input.startedAt) : new Date(Date.now() - durationMs).toISOString(),
    finishedAt: input.finishedAt ? String(input.finishedAt) : now,
    durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    errorSummary: input.ok ? '' : String(input.message || '镜像包生成失败'),
    logFilePath: '',
    createdAt: now,
    updatedAt: now,
    stepMessage: input.ok
      ? `镜像包生成成功: ${input.imageRef || artifactName}`
      : String(input.message || '镜像包生成失败'),
  }
}

function recordDeploymentStep(db, deployment, now) {
  db.prepare(
    `
      INSERT INTO deployment_steps (
        id,
        deployment_id,
        step_order,
        name,
        status,
        command,
        exit_code,
        started_at,
        finished_at,
        duration_ms,
        message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    randomUUID(),
    deployment.id,
    1,
    '本地镜像打包',
    deployment.status,
    'docker build / docker save',
    deployment.status === 'package_success' ? 0 : 1,
    deployment.startedAt,
    deployment.finishedAt || now,
    deployment.durationMs,
    deployment.stepMessage,
  )
}

function mapDeploymentRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    serverId: row.server_id,
    status: row.status,
    artifactName: row.artifact_name,
    deployPath: row.deploy_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    errorSummary: row.error_summary,
    logFilePath: row.log_file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
