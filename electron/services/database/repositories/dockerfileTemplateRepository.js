import { randomUUID } from 'node:crypto'
import { getDatabase } from '../index.js'

/**
 * 读取用户保存的 Dockerfile 模板。
 * 内置模板在前端共享模块中定义，这里只保存用户自定义模板。
 */
export async function listDockerfileTemplates() {
  const db = await getDatabase()
  const rows = db
    .prepare(
      `
        SELECT *
        FROM dockerfile_templates
        ORDER BY updated_at DESC
      `,
    )
    .all()

  return rows.map(mapTemplateRow)
}

/**
 * 新增或更新一个用户 Dockerfile 模板。
 */
export async function saveDockerfileTemplate(input = {}) {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const normalized = normalizeTemplateInput(input, now)

  db.prepare(
    `
      INSERT INTO dockerfile_templates (
        id,
        name,
        description,
        source_type,
        template_text,
        base_image_family,
        java_version,
        java_opts,
        use_non_root_user,
        app_user,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        source_type = excluded.source_type,
        template_text = excluded.template_text,
        base_image_family = excluded.base_image_family,
        java_version = excluded.java_version,
        java_opts = excluded.java_opts,
        use_non_root_user = excluded.use_non_root_user,
        app_user = excluded.app_user,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `,
  ).run(
    normalized.id,
    normalized.name,
    normalized.description,
    normalized.sourceType,
    normalized.templateText,
    normalized.baseImageFamily,
    normalized.javaVersion,
    normalized.javaOpts,
    normalized.useNonRootUser ? 1 : 0,
    normalized.appUser,
    normalized.metadataJson,
    normalized.createdAt,
    normalized.updatedAt,
  )

  return getDockerfileTemplate(normalized.id)
}

/**
 * 按 id 获取一个用户模板。
 */
export async function getDockerfileTemplate(id) {
  const db = await getDatabase()
  const row = db.prepare('SELECT * FROM dockerfile_templates WHERE id = ?').get(String(id || ''))

  return row ? mapTemplateRow(row) : null
}

/**
 * 删除一个用户模板。
 */
export async function deleteDockerfileTemplate(id) {
  const db = await getDatabase()
  const result = db.prepare('DELETE FROM dockerfile_templates WHERE id = ?').run(String(id || ''))

  return {
    deleted: result.changes > 0,
  }
}

function normalizeTemplateInput(input, now) {
  const templateText = String(input.templateText || input.dockerfileText || '').trim()

  if (!templateText) {
    throw new Error('保存模板前请先填写 Dockerfile 内容')
  }

  const name = String(input.name || '').trim() || '未命名 Dockerfile 模板'
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {}

  return {
    id: String(input.id || '').trim() || randomUUID(),
    name,
    description: String(input.description || '').trim(),
    sourceType: String(input.sourceType || 'custom'),
    templateText,
    baseImageFamily: String(input.baseImageFamily || metadata.baseImageFamily || '').trim(),
    javaVersion: String(input.javaVersion || metadata.javaVersion || '').trim(),
    javaOpts: String(input.javaOpts || metadata.javaOpts || '').trim(),
    useNonRootUser: input.useNonRootUser !== undefined ? Boolean(input.useNonRootUser) : true,
    appUser: String(input.appUser || metadata.appUser || '').trim(),
    metadataJson: JSON.stringify(metadata),
    createdAt: input.createdAt ? String(input.createdAt) : now,
    updatedAt: now,
  }
}

function mapTemplateRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sourceType: row.source_type,
    templateText: row.template_text,
    baseImageFamily: row.base_image_family,
    javaVersion: row.java_version,
    javaOpts: row.java_opts,
    useNonRootUser: Boolean(row.use_non_root_user),
    appUser: row.app_user,
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
