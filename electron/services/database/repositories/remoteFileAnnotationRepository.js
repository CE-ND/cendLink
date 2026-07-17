import path from 'node:path'
import { getDatabase } from '../index.js'

const MAX_ANNOTATION_LENGTH = 2000
const QUERY_CHUNK_SIZE = 400

export async function listRemoteFileAnnotations(serverKey, remotePaths = []) {
  const normalizedServerKey = normalizeServerKey(serverKey)
  const normalizedPaths = normalizeRemotePaths(remotePaths)

  if (!normalizedPaths.length) {
    return []
  }

  const db = await getDatabase()
  const rows = []

  for (let index = 0; index < normalizedPaths.length; index += QUERY_CHUNK_SIZE) {
    const chunk = normalizedPaths.slice(index, index + QUERY_CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(', ')
    rows.push(...db
      .prepare(
        `
          SELECT *
          FROM remote_file_annotations
          WHERE server_key = ? AND remote_path IN (${placeholders})
        `,
      )
      .all(normalizedServerKey, ...chunk))
  }

  return rows.map(mapRemoteFileAnnotationRow)
}

export async function saveRemoteFileAnnotation(input = {}) {
  const db = await getDatabase()
  const serverKey = normalizeServerKey(input.serverKey)
  const remotePath = normalizeRemotePath(input.remotePath)
  const annotation = normalizeAnnotation(input.annotation)

  if (!annotation) {
    const result = db
      .prepare('DELETE FROM remote_file_annotations WHERE server_key = ? AND remote_path = ?')
      .run(serverKey, remotePath)

    return {
      serverKey,
      remotePath,
      annotation: '',
      deleted: result.changes > 0,
    }
  }

  const now = new Date().toISOString()
  db.prepare(
    `
      INSERT INTO remote_file_annotations (
        server_key,
        remote_path,
        annotation,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(server_key, remote_path) DO UPDATE SET
        annotation = excluded.annotation,
        updated_at = excluded.updated_at
    `,
  ).run(serverKey, remotePath, annotation, now, now)

  const row = db
    .prepare('SELECT * FROM remote_file_annotations WHERE server_key = ? AND remote_path = ?')
    .get(serverKey, remotePath)

  return mapRemoteFileAnnotationRow(row)
}

export async function moveRemoteFileAnnotations(serverKey, sourcePath, destinationPath) {
  const normalizedServerKey = normalizeServerKey(serverKey)
  const normalizedSourcePath = normalizeRemotePath(sourcePath)
  const normalizedDestinationPath = normalizeRemotePath(destinationPath)

  if (normalizedSourcePath === normalizedDestinationPath) {
    return { moved: 0 }
  }

  const db = await getDatabase()
  const rows = listAnnotationsForServer(db, normalizedServerKey)
    .filter((row) => isPathOrDescendant(row.remote_path, normalizedSourcePath))

  if (!rows.length) {
    return { moved: 0 }
  }

  const sourcePaths = new Set(rows.map((row) => row.remote_path))
  const moves = rows.map((row) => ({
    sourcePath: row.remote_path,
    destinationPath: `${normalizedDestinationPath}${row.remote_path.slice(normalizedSourcePath.length)}`,
  }))
  const now = new Date().toISOString()

  db.exec('BEGIN;')
  try {
    for (const move of moves) {
      if (!sourcePaths.has(move.destinationPath)) {
        db.prepare(
          'DELETE FROM remote_file_annotations WHERE server_key = ? AND remote_path = ?',
        ).run(normalizedServerKey, move.destinationPath)
      }
    }

    for (const move of moves) {
      db.prepare(
        `
          UPDATE remote_file_annotations
          SET remote_path = ?, updated_at = ?
          WHERE server_key = ? AND remote_path = ?
        `,
      ).run(move.destinationPath, now, normalizedServerKey, move.sourcePath)
    }
    db.exec('COMMIT;')
  } catch (error) {
    db.exec('ROLLBACK;')
    throw error
  }

  return { moved: moves.length }
}

export async function deleteRemoteFileAnnotations(serverKey, remotePaths = []) {
  const normalizedServerKey = normalizeServerKey(serverKey)
  const normalizedPaths = normalizeRemotePaths(remotePaths)

  if (!normalizedPaths.length) {
    return { deleted: 0 }
  }

  const db = await getDatabase()
  const pathsToDelete = listAnnotationsForServer(db, normalizedServerKey)
    .map((row) => row.remote_path)
    .filter((candidate) => normalizedPaths.some((target) => isPathOrDescendant(candidate, target)))

  if (!pathsToDelete.length) {
    return { deleted: 0 }
  }

  db.exec('BEGIN;')
  try {
    for (const remotePath of pathsToDelete) {
      db.prepare(
        'DELETE FROM remote_file_annotations WHERE server_key = ? AND remote_path = ?',
      ).run(normalizedServerKey, remotePath)
    }
    db.exec('COMMIT;')
  } catch (error) {
    db.exec('ROLLBACK;')
    throw error
  }

  return { deleted: pathsToDelete.length }
}

function listAnnotationsForServer(db, serverKey) {
  return db
    .prepare('SELECT * FROM remote_file_annotations WHERE server_key = ?')
    .all(serverKey)
}

function normalizeServerKey(value) {
  const serverKey = String(value || '').trim()

  if (!serverKey) {
    throw new Error('缺少文件注解对应的服务器标识')
  }

  return serverKey.slice(0, 500)
}

function normalizeRemotePaths(values) {
  const source = Array.isArray(values) ? values : [values]
  return [...new Set(source.filter(Boolean).map(normalizeRemotePath))]
}

function normalizeRemotePath(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/')

  if (!raw.startsWith('/') || raw.includes('\0')) {
    throw new Error('文件注解必须关联远程绝对路径')
  }

  return path.posix.normalize(raw)
}

function normalizeAnnotation(value) {
  return String(value || '').trim().slice(0, MAX_ANNOTATION_LENGTH)
}

function isPathOrDescendant(candidate, target) {
  return candidate === target || candidate.startsWith(`${target === '/' ? '' : target}/`)
}

function mapRemoteFileAnnotationRow(row) {
  return {
    serverKey: row.server_key,
    remotePath: row.remote_path,
    annotation: row.annotation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
