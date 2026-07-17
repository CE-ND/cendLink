import fs from 'node:fs/promises'
import path from 'node:path'
import ssh2 from 'ssh2'
import { normalizeConnectionInput, toSshConfig } from '../ssh/sshClient.js'

const { Client } = ssh2
const DIRECTORY_MODE = 0o040000
const SYMLINK_MODE = 0o120000
const TYPE_MASK = 0o170000

export async function listRemoteDirectory(connectionInput, remotePath = '/') {
  const normalizedPath = normalizeRemotePath(remotePath)

  return withSftp(connectionInput, async (sftp) => {
    const entries = await sftpReadDir(sftp, normalizedPath)

    return {
      ok: true,
      path: normalizedPath,
      entries: entries
        .filter((entry) => entry?.filename && entry.filename !== '.' && entry.filename !== '..')
        .map((entry) => mapRemoteEntry(normalizedPath, entry))
        .sort(compareRemoteEntries),
    }
  })
}

export async function uploadRemoteFile(connectionInput, input = {}) {
  const localPath = String(input.localPath || '').trim()
  const remoteDir = normalizeRemotePath(input.remoteDir || '/')
  const overwrite = Boolean(input.overwrite)

  if (!localPath) {
    throw createFileError('请选择要上传的本地文件', 'LOCAL_FILE_REQUIRED')
  }

  const localStat = await fs.stat(localPath).catch(() => null)

  if (!localStat?.isFile()) {
    throw createFileError('当前只支持上传文件，暂不支持拖入文件夹', 'LOCAL_FILE_INVALID')
  }

  const fileName = path.basename(localPath)
  validateEntryName(fileName)
  const remotePath = joinRemotePath(remoteDir, fileName)

  return withSftp(connectionInput, async (sftp) => {
    const existing = await sftpLstatOrNull(sftp, remotePath)

    if (existing && !overwrite) {
      throw createFileError(`远程目录中已存在“${fileName}”`, 'REMOTE_FILE_CONFLICT', {
        remotePath,
        fileName,
      })
    }

    if (existing && isDirectoryAttributes(existing)) {
      throw createFileError(`“${fileName}”是一个远程目录，不能用文件覆盖`, 'REMOTE_DIRECTORY_CONFLICT', {
        remotePath,
        fileName,
      })
    }

    await sftpFastPut(sftp, localPath, remotePath)
    const uploaded = await sftpLstat(sftp, remotePath)

    return {
      ok: true,
      localPath,
      remotePath,
      fileName,
      overwritten: Boolean(existing),
      size: Number(uploaded?.size || localStat.size || 0),
    }
  })
}

export async function createRemoteDirectory(connectionInput, input = {}) {
  const parentPath = normalizeRemotePath(input.parentPath || '/')
  const name = validateEntryName(input.name)
  const remotePath = joinRemotePath(parentPath, name)

  return withSftp(connectionInput, async (sftp) => {
    const existing = await sftpLstatOrNull(sftp, remotePath)

    if (existing) {
      throw createFileError(`“${name}”已经存在`, 'REMOTE_FILE_CONFLICT', { remotePath, fileName: name })
    }

    await sftpMkdir(sftp, remotePath, 0o755)

    return {
      ok: true,
      path: remotePath,
      name,
    }
  })
}

export async function renameRemotePath(connectionInput, input = {}) {
  const sourcePath = normalizeRemotePath(input.path)
  const newName = validateEntryName(input.newName)

  ensureMutableRemotePath(sourcePath)

  const destinationPath = joinRemotePath(path.posix.dirname(sourcePath), newName)

  if (destinationPath === sourcePath) {
    return {
      ok: true,
      sourcePath,
      destinationPath,
      unchanged: true,
    }
  }

  return withSftp(connectionInput, async (sftp) => {
    const existing = await sftpLstatOrNull(sftp, destinationPath)

    if (existing) {
      throw createFileError(`“${newName}”已经存在`, 'REMOTE_FILE_CONFLICT', {
        remotePath: destinationPath,
        fileName: newName,
      })
    }

    await sftpRename(sftp, sourcePath, destinationPath)

    return {
      ok: true,
      sourcePath,
      destinationPath,
      name: newName,
    }
  })
}

export async function deleteRemotePaths(connectionInput, input = {}) {
  const paths = Array.from(new Set((Array.isArray(input.paths) ? input.paths : [input.path])
    .map((item) => normalizeRemotePath(item))
    .filter(Boolean)))

  if (!paths.length) {
    throw createFileError('请选择要删除的远程文件或目录', 'REMOTE_PATH_REQUIRED')
  }

  paths.forEach(ensureMutableRemotePath)

  return withSftp(connectionInput, async (sftp) => {
    const deleted = []

    for (const remotePath of paths) {
      await removeRemotePath(sftp, remotePath)
      deleted.push(remotePath)
    }

    return {
      ok: true,
      deleted,
      count: deleted.length,
    }
  })
}

export async function downloadRemoteFile(connectionInput, input = {}) {
  const remotePath = normalizeRemotePath(input.remotePath)
  const localPath = String(input.localPath || '').trim()

  if (!localPath) {
    throw createFileError('请选择本地保存位置', 'LOCAL_PATH_REQUIRED')
  }

  return withSftp(connectionInput, async (sftp) => {
    const attrs = await sftpLstat(sftp, remotePath)

    if (isDirectoryAttributes(attrs)) {
      throw createFileError('暂不支持直接下载整个目录', 'REMOTE_DIRECTORY_DOWNLOAD_UNSUPPORTED')
    }

    await sftpFastGet(sftp, remotePath, localPath)

    return {
      ok: true,
      remotePath,
      localPath,
      size: Number(attrs?.size || 0),
    }
  })
}

export function normalizeRemotePath(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/')

  if (!raw || !raw.startsWith('/')) {
    throw createFileError('远程路径必须使用绝对路径，例如 /opt/app', 'REMOTE_PATH_INVALID')
  }

  if (raw.includes('\0')) {
    throw createFileError('远程路径包含无效字符', 'REMOTE_PATH_INVALID')
  }

  const normalized = path.posix.normalize(raw)
  return normalized === '.' ? '/' : normalized
}

function validateEntryName(value) {
  const name = String(value || '').trim()

  if (!name) {
    throw createFileError('名称不能为空', 'REMOTE_NAME_INVALID')
  }

  if (name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw createFileError('名称不能包含 /、\\，也不能使用 . 或 ..', 'REMOTE_NAME_INVALID')
  }

  if (name.length > 255) {
    throw createFileError('名称不能超过 255 个字符', 'REMOTE_NAME_INVALID')
  }

  return name
}

function ensureMutableRemotePath(remotePath) {
  if (remotePath === '/') {
    throw createFileError('不允许删除或重命名根目录 /', 'REMOTE_ROOT_PROTECTED')
  }
}

async function withSftp(connectionInput, operation) {
  const normalizedConnection = await normalizeConnectionInput(connectionInput)
  const sshConfig = await toSshConfig(normalizedConnection)
  const client = new Client()

  try {
    await connectClient(client, sshConfig)
    const sftp = await openSftp(client)
    return await operation(sftp)
  } finally {
    client.end()
  }
}

function connectClient(client, sshConfig) {
  return new Promise((resolve, reject) => {
    client
      .once('ready', resolve)
      .once('error', reject)
      .once('timeout', () => reject(new Error('连接超时，请检查服务器地址、端口或防火墙')))
      .connect(sshConfig)
  })
}

function openSftp(client) {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error)
        return
      }

      resolve(sftp)
    })
  })
}

function sftpReadDir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error, entries) => {
      if (error) {
        reject(error)
        return
      }

      resolve(Array.isArray(entries) ? entries : [])
    })
  })
}

function sftpLstat(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.lstat(remotePath, (error, attrs) => {
      if (error) {
        reject(error)
        return
      }

      resolve(attrs)
    })
  })
}

async function sftpLstatOrNull(sftp, remotePath) {
  try {
    return await sftpLstat(sftp, remotePath)
  } catch (error) {
    if (Number(error?.code) === 2 || /no such file/i.test(String(error?.message || ''))) {
      return null
    }

    throw error
  }
}

function sftpFastPut(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function sftpFastGet(sftp, remotePath, localPath) {
  return new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function sftpMkdir(sftp, remotePath, mode) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, { mode }, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function sftpRename(sftp, sourcePath, destinationPath) {
  return new Promise((resolve, reject) => {
    sftp.rename(sourcePath, destinationPath, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function sftpUnlink(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function sftpRmdir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remotePath, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

async function removeRemotePath(sftp, remotePath) {
  const attrs = await sftpLstat(sftp, remotePath)

  if (!isDirectoryAttributes(attrs)) {
    await sftpUnlink(sftp, remotePath)
    return
  }

  const entries = await sftpReadDir(sftp, remotePath)

  for (const entry of entries) {
    if (!entry?.filename || entry.filename === '.' || entry.filename === '..') {
      continue
    }

    await removeRemotePath(sftp, joinRemotePath(remotePath, entry.filename))
  }

  await sftpRmdir(sftp, remotePath)
}

function mapRemoteEntry(parentPath, entry) {
  const attrs = entry.attrs || {}
  const mode = Number(attrs.mode || 0)
  const isDirectory = isDirectoryAttributes(attrs, entry.longname)
  const isSymlink = isSymlinkAttributes(attrs, entry.longname)

  return {
    name: entry.filename,
    path: joinRemotePath(parentPath, entry.filename),
    type: isDirectory ? 'directory' : isSymlink ? 'symlink' : 'file',
    isDirectory,
    isSymlink,
    size: Number(attrs.size || 0),
    modifiedAt: attrs.mtime ? new Date(Number(attrs.mtime) * 1000).toISOString() : '',
    accessedAt: attrs.atime ? new Date(Number(attrs.atime) * 1000).toISOString() : '',
    mode,
    permissions: formatPermissions(mode, isDirectory, isSymlink),
    uid: Number.isFinite(Number(attrs.uid)) ? Number(attrs.uid) : null,
    gid: Number.isFinite(Number(attrs.gid)) ? Number(attrs.gid) : null,
  }
}

function isDirectoryAttributes(attrs, longname = '') {
  const mode = Number(attrs?.mode || 0)
  return (mode & TYPE_MASK) === DIRECTORY_MODE || String(longname).startsWith('d')
}

function isSymlinkAttributes(attrs, longname = '') {
  const mode = Number(attrs?.mode || 0)
  return (mode & TYPE_MASK) === SYMLINK_MODE || String(longname).startsWith('l')
}

function formatPermissions(mode, isDirectory, isSymlink) {
  if (!mode) {
    return '-'
  }

  const prefix = isDirectory ? 'd' : isSymlink ? 'l' : '-'
  const bits = [
    [0o400, 'r'], [0o200, 'w'], [0o100, 'x'],
    [0o040, 'r'], [0o020, 'w'], [0o010, 'x'],
    [0o004, 'r'], [0o002, 'w'], [0o001, 'x'],
  ]

  return `${prefix}${bits.map(([mask, char]) => (mode & mask ? char : '-')).join('')}`
}

function compareRemoteEntries(left, right) {
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1
  }

  return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function joinRemotePath(parentPath, name) {
  return path.posix.join(parentPath === '/' ? '/' : normalizeRemotePath(parentPath), name)
}

function createFileError(message, code, details = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, details)
  return error
}
