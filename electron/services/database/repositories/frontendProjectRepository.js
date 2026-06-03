import { randomUUID } from 'node:crypto'
import { getDatabase } from '../index.js'

const DEFAULT_REMOTE_BASE_DIR = '/opt/app/nginx/html'
const DEFAULT_REMOTE_UPLOAD_DIR = '/opt/cendlink/frontend-packages'
const DEFAULT_ENTRY_FILE = 'index.html'

export async function listFrontendProjects() {
  const db = await getDatabase()
  const rows = db
    .prepare(
      `
        SELECT *
        FROM frontend_projects
        ORDER BY updated_at DESC
      `,
    )
    .all()

  return rows.map(mapFrontendProjectRow)
}

export async function saveFrontendProject(input = {}) {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const normalized = normalizeFrontendProjectInput(input, now)

  db.prepare(
    `
      INSERT INTO frontend_projects (
        id,
        name,
        project_dir,
        remote_base_dir,
        remote_target_dir,
        remote_upload_dir,
        extract_strategy,
        keep_remote_archive,
        entry_file,
        last_package_path,
        last_uploaded_at,
        last_server_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        project_dir = excluded.project_dir,
        remote_base_dir = excluded.remote_base_dir,
        remote_target_dir = excluded.remote_target_dir,
        remote_upload_dir = excluded.remote_upload_dir,
        extract_strategy = excluded.extract_strategy,
        keep_remote_archive = excluded.keep_remote_archive,
        entry_file = excluded.entry_file,
        last_package_path = excluded.last_package_path,
        last_uploaded_at = excluded.last_uploaded_at,
        last_server_id = excluded.last_server_id,
        updated_at = excluded.updated_at
    `,
  ).run(
    normalized.id,
    normalized.name,
    normalized.projectDir,
    normalized.remoteBaseDir,
    normalized.remoteTargetDir,
    normalized.remoteUploadDir,
    normalized.extractStrategy,
    normalized.keepRemoteArchive ? 1 : 0,
    normalized.entryFile,
    normalized.lastPackagePath,
    normalized.lastUploadedAt,
    normalized.lastServerId,
    normalized.createdAt,
    normalized.updatedAt,
  )

  return getFrontendProject(normalized.id)
}

export async function getFrontendProject(id) {
  const db = await getDatabase()
  const row = db.prepare('SELECT * FROM frontend_projects WHERE id = ?').get(String(id || ''))

  return row ? mapFrontendProjectRow(row) : null
}

export async function deleteFrontendProject(id) {
  const db = await getDatabase()
  const result = db.prepare('DELETE FROM frontend_projects WHERE id = ?').run(String(id || ''))

  return {
    deleted: result.changes > 0,
  }
}

function normalizeFrontendProjectInput(input, now) {
  const name = String(input.name || input.projectName || '').trim() || '未命名前端项目'
  const projectDir = normalizeProjectDir(input.projectDir || name)
  const remoteBaseDir = normalizeUnixPath(input.remoteBaseDir || DEFAULT_REMOTE_BASE_DIR)
  const remoteTargetDir = normalizeUnixPath(input.remoteTargetDir || joinUnix(remoteBaseDir, projectDir))
  const remoteUploadDir = normalizeUnixPath(input.remoteUploadDir || DEFAULT_REMOTE_UPLOAD_DIR)

  return {
    id: String(input.id || '').trim() || randomUUID(),
    name,
    projectDir,
    remoteBaseDir,
    remoteTargetDir,
    remoteUploadDir,
    extractStrategy: normalizeExtractStrategy(input.extractStrategy),
    keepRemoteArchive: Boolean(input.keepRemoteArchive),
    entryFile: normalizeEntryFile(input.entryFile),
    lastPackagePath: String(input.lastPackagePath || input.localArchivePath || '').trim(),
    lastUploadedAt: input.lastUploadedAt ? String(input.lastUploadedAt) : null,
    lastServerId: input.lastServerId ? String(input.lastServerId) : null,
    createdAt: input.createdAt ? String(input.createdAt) : now,
    updatedAt: now,
  }
}

function mapFrontendProjectRow(row) {
  return {
    id: row.id,
    name: row.name,
    projectDir: row.project_dir,
    remoteBaseDir: row.remote_base_dir,
    remoteTargetDir: row.remote_target_dir,
    remoteUploadDir: row.remote_upload_dir,
    extractStrategy: row.extract_strategy,
    keepRemoteArchive: Boolean(row.keep_remote_archive),
    entryFile: row.entry_file,
    lastPackagePath: row.last_package_path,
    lastUploadedAt: row.last_uploaded_at,
    lastServerId: row.last_server_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeProjectDir(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
    .replace(/[^a-zA-Z0-9._/-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'frontend'
}

function normalizeUnixPath(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/g, '')
}

function normalizeExtractStrategy(value) {
  return value === 'backup' ? 'backup' : value === 'overwrite' ? 'overwrite' : 'clean'
}

function normalizeEntryFile(value) {
  const normalized = String(value || DEFAULT_ENTRY_FILE).trim().replace(/^\/+/, '')
  return normalized && !normalized.includes('..') ? normalized : DEFAULT_ENTRY_FILE
}

function joinUnix(...parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
}
