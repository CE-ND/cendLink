import { randomUUID } from 'node:crypto'
import { getDatabase } from '../index.js'

/**
 * 读取用户保存的服务模板。
 * 服务模板保存业务服务的打包/部署默认值，可引用 Dockerfile 模板，但不保存 Dockerfile 内容语义。
 */
export async function listServiceTemplates() {
  const db = await getDatabase()
  const rows = db
    .prepare(
      `
        SELECT *
        FROM service_templates
        ORDER BY updated_at DESC
      `,
    )
    .all()

  return rows.map(mapServiceTemplateRow)
}

/**
 * 新增或更新一个服务模板。
 */
export async function saveServiceTemplate(input = {}) {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const normalized = normalizeServiceTemplateInput(input, now)

  db.prepare(
    `
      INSERT INTO service_templates (
        id,
        name,
        description,
        service_name,
        package_config_json,
        deploy_config_json,
        last_package_version,
        last_image_tag,
        last_package_path,
        last_packaged_at,
        last_deployed_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        service_name = excluded.service_name,
        package_config_json = excluded.package_config_json,
        deploy_config_json = excluded.deploy_config_json,
        last_package_version = excluded.last_package_version,
        last_image_tag = excluded.last_image_tag,
        last_package_path = excluded.last_package_path,
        last_packaged_at = excluded.last_packaged_at,
        last_deployed_at = excluded.last_deployed_at,
        updated_at = excluded.updated_at
    `,
  ).run(
    normalized.id,
    normalized.name,
    normalized.description,
    normalized.serviceName,
    normalized.packageConfigJson,
    normalized.deployConfigJson,
    normalized.lastPackageVersion,
    normalized.lastImageTag,
    normalized.lastPackagePath,
    normalized.lastPackagedAt,
    normalized.lastDeployedAt,
    normalized.createdAt,
    normalized.updatedAt,
  )

  return getServiceTemplate(normalized.id)
}

/**
 * 按 id 获取服务模板。
 */
export async function getServiceTemplate(id) {
  const db = await getDatabase()
  const row = db.prepare('SELECT * FROM service_templates WHERE id = ?').get(String(id || ''))

  return row ? mapServiceTemplateRow(row) : null
}

/**
 * 删除服务模板。
 */
export async function deleteServiceTemplate(id) {
  const db = await getDatabase()
  const result = db.prepare('DELETE FROM service_templates WHERE id = ?').run(String(id || ''))

  return {
    deleted: result.changes > 0,
  }
}

function normalizeServiceTemplateInput(input, now) {
  const packageConfig = normalizePlainObject(input.packageConfig)
  const deployConfig = normalizePlainObject(input.deployConfig)
  const serviceName = String(
    input.serviceName || packageConfig.serviceName || deployConfig.serviceName || '',
  ).trim()
  const name = String(input.name || serviceName || '').trim() || '未命名服务模板'

  return {
    id: String(input.id || '').trim() || randomUUID(),
    name,
    description: String(input.description || '').trim(),
    serviceName,
    packageConfigJson: JSON.stringify(packageConfig),
    deployConfigJson: JSON.stringify(deployConfig),
    lastPackageVersion: String(input.lastPackageVersion || '').trim(),
    lastImageTag: String(input.lastImageTag || '').trim(),
    lastPackagePath: String(input.lastPackagePath || '').trim(),
    lastPackagedAt: input.lastPackagedAt ? String(input.lastPackagedAt) : null,
    lastDeployedAt: input.lastDeployedAt ? String(input.lastDeployedAt) : null,
    createdAt: input.createdAt ? String(input.createdAt) : now,
    updatedAt: now,
  }
}

function normalizePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return { ...value }
}

function mapServiceTemplateRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    serviceName: row.service_name,
    packageConfig: parseJsonObject(row.package_config_json),
    deployConfig: parseJsonObject(row.deploy_config_json),
    lastPackageVersion: row.last_package_version,
    lastImageTag: row.last_image_tag,
    lastPackagePath: row.last_package_path,
    lastPackagedAt: row.last_packaged_at,
    lastDeployedAt: row.last_deployed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
