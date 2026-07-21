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
        remote_package_path,
        run_command,
        metadata_json,
        started_at,
        finished_at,
        duration_ms,
        error_summary,
        log_file_path,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    normalized.id,
    normalized.projectId,
    normalized.serverId,
    normalized.status,
    normalized.artifactName,
    normalized.deployPath,
    normalized.remotePackagePath,
    normalized.runCommand,
    normalized.metadataJson,
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
 * 保存一次真实远程部署记录。
 * 会同时写入 deployments 主记录和 deployment_steps 步骤明细。
 */
export async function recordRemoteDeployment(input = {}) {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const normalized = normalizeRemoteDeploymentInput(input, now)

  db.prepare(
    `
      INSERT INTO deployments (
        id,
        project_id,
        server_id,
        status,
        artifact_name,
        deploy_path,
        remote_package_path,
        run_command,
        metadata_json,
        started_at,
        finished_at,
        duration_ms,
        error_summary,
        log_file_path,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    normalized.id,
    normalized.projectId,
    normalized.serverId,
    normalized.status,
    normalized.artifactName,
    normalized.deployPath,
    normalized.remotePackagePath,
    normalized.runCommand,
    normalized.metadataJson,
    normalized.startedAt,
    normalized.finishedAt,
    normalized.durationMs,
    normalized.errorSummary,
    normalized.logFilePath,
    normalized.createdAt,
    normalized.updatedAt,
  )

  for (const step of normalized.steps) {
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
      normalized.id,
      step.stepOrder,
      step.name,
      step.status,
      step.command,
      step.exitCode,
      step.startedAt,
      step.finishedAt,
      step.durationMs,
      step.message,
    )
  }

  return getDeployment(normalized.id)
}

/**
 * 保存一次前端静态资源上传记录。
 */
export async function recordFrontendUpload(input = {}) {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const normalized = normalizeFrontendUploadInput(input, now)

  db.prepare(
    `
      INSERT INTO deployments (
        id,
        project_id,
        server_id,
        status,
        artifact_name,
        deploy_path,
        remote_package_path,
        run_command,
        metadata_json,
        started_at,
        finished_at,
        duration_ms,
        error_summary,
        log_file_path,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    normalized.id,
    normalized.projectId,
    normalized.serverId,
    normalized.status,
    normalized.artifactName,
    normalized.deployPath,
    normalized.remotePackagePath,
    normalized.runCommand,
    normalized.metadataJson,
    normalized.startedAt,
    normalized.finishedAt,
    normalized.durationMs,
    normalized.errorSummary,
    normalized.logFilePath,
    normalized.createdAt,
    normalized.updatedAt,
  )

  for (const step of normalized.steps) {
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
      normalized.id,
      step.stepOrder,
      step.name,
      step.status,
      step.command,
      step.exitCode,
      step.startedAt,
      step.finishedAt,
      step.durationMs,
      step.message,
    )
  }

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

/**
 * 删除一条部署/镜像包记录。
 * deployment_steps 依赖外键级联自动删除。
 */
export async function deleteDeployment(id) {
  const db = await getDatabase()
  const result = db.prepare('DELETE FROM deployments WHERE id = ?').run(String(id || ''))

  return {
    deleted: result.changes > 0,
  }
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
    remotePackagePath: '',
    runCommand: '',
    metadataJson: JSON.stringify({
      recordType: 'image-package',
      packageFileName: input.packageFileName || '',
      packagePath: input.packagePath || '',
      imageRef: input.imageRef || '',
      serviceName: input.serviceName || '',
      serviceVersion: input.serviceVersion || '',
      servicePort: input.servicePort || 0,
      javaVersion: input.javaVersion || '',
      baseImage: input.baseImage || '',
      useNonRootUser: Boolean(input.useNonRootUser),
      appUser: input.appUser || '',
      dockerfileTemplateId: input.dockerfileTemplateId || '',
      dockerfileTemplateName: input.dockerfileTemplateName || '',
      dockerfileTemplateDescription: input.dockerfileTemplateDescription || '',
      dockerfileSourceType: input.dockerfileSourceType || '',
      dockerfileTemplateText: input.dockerfileTemplateText || '',
      dockerfileText: input.dockerfileText || '',
      baseImageFamily: input.baseImageFamily || '',
    }),
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

function normalizeRemoteDeploymentInput(input, now) {
  const durationMs = Number(input.durationMs || 0)
  const steps = normalizeDeploymentSteps(input.steps)
  const runCommand = String(input.runCommand || '').trim()
  const cleanupCommand = String(input.cleanupCommand || '').trim()
  const remoteReleaseDir = String(input.remoteReleaseDir || '').trim()
  const remotePackagePath = String(input.remotePackagePath || '').trim()
  const artifactName = String(input.imageRef || input.containerName || input.packageFileName || 'remote-deployment')
  const deployPath = remoteReleaseDir || String(input.remotePackagePath || '').trim()
  const cleanupSummary = String(input.cleanupSummary || '').trim()
  const errorSummary = input.ok
    ? cleanupSummary || ''
    : String(input.message || input.errorSummary || '远程部署失败')

  return {
    id: String(input.id || '').trim() || randomUUID(),
    projectId: String(input.imageRef || input.containerName || artifactName),
    serverId: input.serverId ? String(input.serverId) : null,
    status: input.ok ? 'deploy_success' : 'deploy_failed',
    artifactName,
    deployPath,
    remotePackagePath,
    runCommand,
    metadataJson: JSON.stringify({
      recordType: 'remote-deployment',
      localPackagePath: input.localPackagePath || '',
      remotePackagePath,
      remoteReleaseDir,
      imageRef: input.imageRef || '',
      containerName: input.containerName || '',
      runCommand,
      cleanupCommand,
      cleanupSummary,
      networkName: input.networkName || '',
      nginxProxyCheckEnabled: input.nginxProxyCheckEnabled !== false,
      nginxContainerName: input.nginxContainerName || '',
      nginxProxyTarget: input.nginxProxyTarget || '',
      warnings: Array.isArray(input.warnings) ? input.warnings : [],
      nginxDiagnostics: input.nginxDiagnostics || null,
    }),
    startedAt: input.startedAt ? String(input.startedAt) : new Date(Date.now() - durationMs).toISOString(),
    finishedAt: input.finishedAt ? String(input.finishedAt) : now,
    durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    errorSummary,
    logFilePath: '',
    createdAt: now,
    updatedAt: now,
    steps: steps.length
      ? steps
      : [
          {
            stepOrder: 1,
            name: '远程部署',
            status: input.ok ? 'success' : 'failed',
            command: runCommand || cleanupCommand || 'docker deployment',
            exitCode: input.ok ? 0 : 1,
            startedAt: input.startedAt ? String(input.startedAt) : now,
            finishedAt: input.finishedAt ? String(input.finishedAt) : now,
            durationMs: Number.isFinite(durationMs) ? durationMs : 0,
            message: input.ok ? '部署成功' : errorSummary,
          },
        ],
  }
}

function normalizeFrontendUploadInput(input, now) {
  const durationMs = Number(input.durationMs || 0)
  const steps = normalizeDeploymentSteps(input.steps)
  const projectName = String(input.projectName || input.projectDir || 'frontend-project').trim()
  const remoteTargetDir = String(input.remoteTargetDir || '').trim()
  const remoteArchivePath = String(input.remoteArchivePath || '').trim()
  const artifactName = String(input.localArchiveName || input.artifactName || projectName || 'frontend-upload')
  const runCommand =
    String(input.runCommand || '').trim() ||
    `frontend upload ${remoteArchivePath || artifactName} -> ${remoteTargetDir || '-'}`
  const errorSummary = input.ok ? String(input.backupDir || '').trim() : String(input.message || '前端上传失败')

  return {
    id: String(input.id || '').trim() || randomUUID(),
    projectId: String(projectName || input.projectDir || artifactName),
    serverId: input.serverId ? String(input.serverId) : null,
    status: input.ok ? 'frontend_success' : 'frontend_failed',
    artifactName,
    deployPath: remoteTargetDir,
    remotePackagePath: remoteArchivePath,
    runCommand,
    metadataJson: JSON.stringify({
      recordType: 'frontend-upload',
      projectName,
      projectDir: input.projectDir || '',
      localArchivePath: input.localArchivePath || '',
      localArchiveName: input.localArchiveName || '',
      remoteArchivePath,
      remoteTargetDir,
      remoteBaseDir: input.remoteBaseDir || '',
      extractStrategy: input.extractStrategy || '',
      keepRemoteArchive: Boolean(input.keepRemoteArchive),
      entryFile: input.entryFile || '',
      restartNginx: Boolean(input.restartNginx),
      nginxRestartCommand: input.nginxRestartCommand || '',
      nginxRestarted: Boolean(input.nginxRestarted),
      publishedSourceDir: input.publishedSourceDir || '',
      backupDir: input.backupDir || '',
      publishedFileCount: Number(input.publishedFileCount || 0),
    }),
    startedAt: input.startedAt ? String(input.startedAt) : new Date(Date.now() - durationMs).toISOString(),
    finishedAt: input.finishedAt ? String(input.finishedAt) : now,
    durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    errorSummary,
    logFilePath: '',
    createdAt: now,
    updatedAt: now,
    steps: steps.length
      ? steps
      : [
          {
            stepOrder: 1,
            name: '前端上传',
            status: input.ok ? 'success' : 'failed',
            command: runCommand,
            exitCode: input.ok ? 0 : 1,
            startedAt: input.startedAt ? String(input.startedAt) : now,
            finishedAt: input.finishedAt ? String(input.finishedAt) : now,
            durationMs: Number.isFinite(durationMs) ? durationMs : 0,
            message: input.ok ? '前端上传成功' : errorSummary,
          },
        ],
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

function normalizeDeploymentSteps(input) {
  if (!Array.isArray(input)) {
    return []
  }

  return input.map((step, index) => ({
    stepOrder: index + 1,
    name: String(step?.name || `步骤 ${index + 1}`),
    status: String(step?.status || 'unknown'),
    command: String(step?.command || ''),
    exitCode: Number.isInteger(step?.exitCode) ? step.exitCode : step?.status === 'success' ? 0 : 1,
    startedAt: step?.startedAt ? String(step.startedAt) : null,
    finishedAt: step?.finishedAt ? String(step.finishedAt) : null,
    durationMs: Number(step?.durationMs || 0),
    message: String(step?.message || ''),
  }))
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
    remotePackagePath: row.remote_package_path || '',
    runCommand: row.run_command || '',
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseMetadata(value) {
  try {
    return JSON.parse(String(value || '{}'))
  } catch {
    return {}
  }
}
