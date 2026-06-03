import fs from 'node:fs/promises'
import path from 'node:path'
import ssh2 from 'ssh2'
import { normalizeConnectionInput, toSshConfig } from '../ssh/sshClient.js'

const { Client } = ssh2

const DEFAULT_REMOTE_BASE_DIR = '/opt/app/nginx/html'
const DEFAULT_REMOTE_UPLOAD_DIR = '/opt/cendlink/frontend-packages'
const DEFAULT_ENTRY_FILE = 'index.html'
const FRONTEND_SOURCE_MARKER = '__CENDLINK_FRONTEND_SOURCE__='
const FRONTEND_BACKUP_MARKER = '__CENDLINK_FRONTEND_BACKUP__='
const FRONTEND_FILE_COUNT_MARKER = '__CENDLINK_FRONTEND_FILE_COUNT__='

export async function runFrontendUpload(connectionInput, uploadInput = {}) {
  const startedAt = Date.now()
  const normalizedConnection = await normalizeConnectionInput(connectionInput)
  const normalized = await normalizeFrontendUploadInput(uploadInput, { requireLocalArchive: true })
  const logs = []
  const steps = []

  appendLog(logs, `开始上传前端项目 ${normalized.projectName} -> ${normalized.remoteTargetDir}`)

  const sshConfig = await toSshConfig(normalizedConnection)
  const client = new Client()

  try {
    await connectClient(client, sshConfig, logs)
    const sftp = await openSftp(client)

    await runStep({
      logs,
      steps,
      name: '远程预检',
      command: buildPrecheckCommand(normalized),
      runner: async () => {
        return execCommand(client, buildPrecheckCommand(normalized))
      },
    })

    await runStep({
      logs,
      steps,
      name: '上传压缩包',
      command: `upload ${normalized.localArchivePath} -> ${normalized.remoteArchivePath}`,
      runner: async () => {
        await uploadFile(sftp, normalized.localArchivePath, normalized.remoteArchivePath)
      },
    })

    const publishResult = await runStep({
      logs,
      steps,
      name: '解压并发布',
      command: buildPublishLogCommand(normalized),
      runner: async () => {
        return execCommand(client, buildPublishCommand(normalized))
      },
    })

    const parsedOutput = parsePublishOutput(publishResult.stdout)

    return {
      ok: true,
      status: 'success',
      message: '前端上传成功',
      projectName: normalized.projectName,
      projectDir: normalized.projectDir,
      localArchivePath: normalized.localArchivePath,
      localArchiveName: normalized.localArchiveName,
      remoteArchivePath: normalized.remoteArchivePath,
      remoteTargetDir: normalized.remoteTargetDir,
      remoteBaseDir: normalized.remoteBaseDir,
      extractStrategy: normalized.extractStrategy,
      keepRemoteArchive: normalized.keepRemoteArchive,
      entryFile: normalized.entryFile,
      publishedSourceDir: parsedOutput.sourceDir,
      backupDir: parsedOutput.backupDir,
      publishedFileCount: parsedOutput.fileCount,
      steps,
      logs,
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      uploadConfig: normalized,
    }
  } catch (error) {
    appendLog(logs, error?.message || String(error))

    return {
      ok: false,
      status: 'failed',
      message: error?.message || '前端上传失败',
      projectName: normalized.projectName,
      projectDir: normalized.projectDir,
      localArchivePath: normalized.localArchivePath,
      localArchiveName: normalized.localArchiveName,
      remoteArchivePath: normalized.remoteArchivePath,
      remoteTargetDir: normalized.remoteTargetDir,
      remoteBaseDir: normalized.remoteBaseDir,
      extractStrategy: normalized.extractStrategy,
      keepRemoteArchive: normalized.keepRemoteArchive,
      entryFile: normalized.entryFile,
      publishedSourceDir: '',
      backupDir: '',
      publishedFileCount: 0,
      steps,
      logs,
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      uploadConfig: normalized,
    }
  } finally {
    client.end()
  }
}

export async function previewFrontendUpload(uploadInput = {}) {
  const normalized = await normalizeFrontendUploadInput(uploadInput, { requireLocalArchive: false })

  return {
    ...normalized,
    precheckCommand: buildPrecheckCommand(normalized),
    publishCommand: buildPublishLogCommand(normalized),
  }
}

async function normalizeFrontendUploadInput(input = {}, options = {}) {
  const localArchivePath = String(input.localArchivePath || input.packagePath || '').trim()
  const projectName = String(input.projectName || input.name || inferProjectName(localArchivePath) || '').trim()
  const projectDir = normalizeProjectDir(input.projectDir || projectName)
  const remoteBaseDir = normalizeUnixPath(input.remoteBaseDir || DEFAULT_REMOTE_BASE_DIR)
  const remoteTargetDir = normalizeUnixPath(input.remoteTargetDir || joinUnix(remoteBaseDir, projectDir))
  const remoteUploadDir = normalizeUnixPath(input.remoteUploadDir || DEFAULT_REMOTE_UPLOAD_DIR)
  const extractStrategy = normalizeExtractStrategy(input.extractStrategy)
  const keepRemoteArchive = Boolean(input.keepRemoteArchive)
  const entryFile = normalizeEntryFile(input.entryFile)
  const localArchiveName = localArchivePath ? path.basename(localArchivePath) : ''
  const archiveType = localArchivePath ? getArchiveType(localArchiveName) : ''
  const remoteArchivePath = localArchiveName
    ? buildRemoteArchivePath(remoteUploadDir, projectDir, localArchiveName)
    : ''

  if (!projectName) {
    throw new Error('请填写前端项目名称')
  }

  ensureSafeRemoteTarget(remoteBaseDir, remoteTargetDir)

  if (localArchivePath || options.requireLocalArchive) {
    if (!localArchivePath) {
      throw new Error('请选择前端压缩包')
    }

    if (!archiveType) {
      throw new Error('前端压缩包仅支持 zip、tar、tar.gz、tgz')
    }

    const stat = await fs.stat(localArchivePath).catch(() => null)

    if (!stat?.isFile()) {
      throw new Error('前端压缩包文件不存在')
    }
  }

  return {
    localArchivePath,
    localArchiveName,
    archiveType,
    projectName,
    projectDir,
    remoteBaseDir,
    remoteTargetDir,
    remoteUploadDir,
    remoteArchivePath,
    extractStrategy,
    keepRemoteArchive,
    entryFile,
  }
}

function buildPrecheckCommand(config) {
  const archiveDir = config.remoteArchivePath ? pathDirnameUnix(config.remoteArchivePath) : config.remoteUploadDir
  const toolCheck =
    config.archiveType === 'zip'
      ? 'command -v unzip >/dev/null 2>&1 || { echo "远程服务器缺少 unzip，无法解压 zip 包"; exit 11; }'
      : 'command -v tar >/dev/null 2>&1 || { echo "远程服务器缺少 tar，无法解压 tar 包"; exit 11; }'

  return [
    `mkdir -p ${shellQuote(archiveDir)} ${shellQuote(pathDirnameUnix(config.remoteTargetDir))}`,
    toolCheck,
  ].join(' && ')
}

function buildPublishLogCommand(config) {
  return [
    `extract ${config.remoteArchivePath || '<archive>'}`,
    `publish ${config.remoteTargetDir}`,
    `strategy ${config.extractStrategy}`,
  ].join(' && ')
}

function buildPublishCommand(config) {
  const extractCommand = buildExtractCommand(config)
  const replaceCommand = buildReplaceCommand(config)
  const cleanupArchiveCommand = config.keepRemoteArchive ? '' : `rm -f "$ARCHIVE_PATH"`

  return `
set -e
ARCHIVE_PATH=${shellQuote(config.remoteArchivePath)}
TARGET_DIR=${shellQuote(config.remoteTargetDir)}
ENTRY_FILE=${shellQuote(config.entryFile)}
STAMP=$(date +%Y%m%d%H%M%S)
TMP_DIR=$(mktemp -d /tmp/cendlink-frontend.XXXXXX)
PUBLISH_DIR="$TARGET_DIR.__cendlink_next_$STAMP"
BACKUP_DIR=""
cleanup() {
  rm -rf "$TMP_DIR" "$PUBLISH_DIR"
}
trap cleanup EXIT
rm -rf "$PUBLISH_DIR"
mkdir -p "$PUBLISH_DIR"
${extractCommand}
SOURCE_DIR="$TMP_DIR"
ROOT_ITEMS=$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')
SINGLE_DIR=$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)
if [ -f "$TMP_DIR/$ENTRY_FILE" ]; then
  SOURCE_DIR="$TMP_DIR"
elif [ -f "$TMP_DIR/dist/$ENTRY_FILE" ]; then
  SOURCE_DIR="$TMP_DIR/dist"
elif [ "$ROOT_ITEMS" = "1" ] && [ -n "$SINGLE_DIR" ] && [ -f "$SINGLE_DIR/$ENTRY_FILE" ]; then
  SOURCE_DIR="$SINGLE_DIR"
elif [ "$ROOT_ITEMS" = "1" ] && [ -n "$SINGLE_DIR" ] && [ -f "$SINGLE_DIR/dist/$ENTRY_FILE" ]; then
  SOURCE_DIR="$SINGLE_DIR/dist"
else
  echo "压缩包内未找到 $ENTRY_FILE"
  exit 12
fi
cp -a "$SOURCE_DIR"/. "$PUBLISH_DIR"/
test -f "$PUBLISH_DIR/$ENTRY_FILE"
${replaceCommand}
${cleanupArchiveCommand}
FILE_COUNT=$(find "$TARGET_DIR" -mindepth 1 -maxdepth 2 | wc -l | tr -d ' ')
echo "${FRONTEND_SOURCE_MARKER}$SOURCE_DIR"
echo "${FRONTEND_BACKUP_MARKER}$BACKUP_DIR"
echo "${FRONTEND_FILE_COUNT_MARKER}$FILE_COUNT"
`.trim()
}

function buildExtractCommand(config) {
  if (config.archiveType === 'zip') {
    return 'unzip -oq "$ARCHIVE_PATH" -d "$TMP_DIR"'
  }

  if (config.archiveType === 'tar.gz' || config.archiveType === 'tgz') {
    return 'tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"'
  }

  return 'tar -xf "$ARCHIVE_PATH" -C "$TMP_DIR"'
}

function buildReplaceCommand(config) {
  if (config.extractStrategy === 'overwrite') {
    return `
mkdir -p "$TARGET_DIR"
cp -a "$PUBLISH_DIR"/. "$TARGET_DIR"/
rm -rf "$PUBLISH_DIR"
`.trim()
  }

  const backupCommand =
    config.extractStrategy === 'backup'
      ? `
if [ -e "$TARGET_DIR" ]; then
  BACKUP_DIR="$TARGET_DIR.__backup_$STAMP"
  mv "$TARGET_DIR" "$BACKUP_DIR"
fi
`.trim()
      : `
if [ -e "$TARGET_DIR" ]; then
  rm -rf "$TARGET_DIR"
fi
`.trim()

  return `
mkdir -p "$(dirname "$TARGET_DIR")"
${backupCommand}
mv "$PUBLISH_DIR" "$TARGET_DIR"
`.trim()
}

async function connectClient(client, sshConfig, logs) {
  await new Promise((resolve, reject) => {
    client
      .on('ready', () => {
        appendLog(logs, 'SSH 连接成功，开始执行前端上传')
        resolve()
      })
      .on('error', (error) => {
        reject(error)
      })
      .connect(sshConfig)
  })
}

async function openSftp(client) {
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

async function uploadFile(sftp, localPath, remotePath) {
  await new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

async function runStep({ logs, steps, name, command, runner }) {
  const startedAt = Date.now()
  appendLog(logs, `[${name}] ${command}`)

  try {
    const result = await runner()
    const step = {
      name,
      status: 'success',
      command,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      stdout: result?.stdout || '',
      stderr: result?.stderr || '',
      message: '执行成功',
    }

    steps.push(step)
    appendLog(logs, `${name} 完成`)
    appendStepOutput(logs, step)
    return result || { stdout: '', stderr: '' }
  } catch (error) {
    const step = {
      name,
      status: 'failed',
      command,
      exitCode: 1,
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      stdout: '',
      stderr: error?.message || String(error),
      message: error?.message || String(error),
    }

    steps.push(step)
    appendLog(logs, `${name} 失败: ${step.message}`)
    throw error
  }
}

async function execCommand(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error)
        return
      }

      let stdout = ''
      let stderr = ''

      stream
        .on('close', (code) => {
          if ((code ?? 0) !== 0) {
            reject(new Error((stderr || stdout || `命令执行失败，退出码 ${code}`).trim()))
            return
          }

          resolve({
            stdout,
            stderr,
          })
        })
        .on('data', (data) => {
          stdout += data.toString()
        })

      stream.stderr.on('data', (data) => {
        stderr += data.toString()
      })
    })
  })
}

function normalizeProjectDir(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')

  if (!normalized) {
    throw new Error('请填写项目目录名')
  }

  if (normalized.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error('项目目录不能包含 . 或 ..')
  }

  return normalized
}

function normalizeUnixPath(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/g, '')

  if (!normalized.startsWith('/')) {
    throw new Error('远程目录必须使用绝对路径')
  }

  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error('远程目录不能包含 ..')
  }

  return normalized
}

function normalizeEntryFile(value) {
  const normalized = String(value || DEFAULT_ENTRY_FILE).trim().replace(/^\/+/, '')

  if (!normalized || normalized.includes('..')) {
    return DEFAULT_ENTRY_FILE
  }

  return normalized
}

function normalizeExtractStrategy(value) {
  return value === 'backup' ? 'backup' : value === 'overwrite' ? 'overwrite' : 'clean'
}

function ensureSafeRemoteTarget(remoteBaseDir, remoteTargetDir) {
  if (remoteTargetDir === remoteBaseDir) {
    throw new Error('发布目录不能直接使用 Nginx 根目录，请补充项目目录')
  }

  if (!remoteTargetDir.startsWith(`${remoteBaseDir}/`)) {
    throw new Error(`发布目录必须位于 ${remoteBaseDir}/ 下`)
  }
}

function getArchiveType(fileName) {
  const lowerName = String(fileName || '').toLowerCase()

  if (lowerName.endsWith('.tar.gz')) {
    return 'tar.gz'
  }

  if (lowerName.endsWith('.tgz')) {
    return 'tgz'
  }

  if (lowerName.endsWith('.tar')) {
    return 'tar'
  }

  if (lowerName.endsWith('.zip')) {
    return 'zip'
  }

  return ''
}

function inferProjectName(localArchivePath) {
  const fileName = path.basename(String(localArchivePath || ''), path.extname(String(localArchivePath || '')))
  return fileName.replace(/\.tar$/i, '').replace(/\.gz$/i, '')
}

function buildRemoteArchivePath(remoteUploadDir, projectDir, localArchiveName) {
  return joinUnix(remoteUploadDir, toRemoteSafePart(projectDir), localArchiveName)
}

function toRemoteSafePart(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'frontend'
}

function parsePublishOutput(output = '') {
  const lines = String(output || '').replace(/\r\n/g, '\n').split('\n')

  return {
    sourceDir: readMarker(lines, FRONTEND_SOURCE_MARKER),
    backupDir: readMarker(lines, FRONTEND_BACKUP_MARKER),
    fileCount: Number(readMarker(lines, FRONTEND_FILE_COUNT_MARKER) || 0),
  }
}

function readMarker(lines, marker) {
  const line = lines.find((item) => item.startsWith(marker))
  return line ? line.slice(marker.length).trim() : ''
}

function appendLog(logs, message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logs.push(`[${time}] ${message}`)
}

function appendStepOutput(logs, step) {
  if (step.stdout) {
    logs.push(...step.stdout.replace(/\r\n/g, '\n').split('\n').filter(Boolean))
  }

  if (step.stderr) {
    logs.push(...step.stderr.replace(/\r\n/g, '\n').split('\n').filter(Boolean))
  }
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`
}

function pathDirnameUnix(value) {
  const normalized = normalizeUnixPath(value)
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? '/' : normalized.slice(0, index)
}

function joinUnix(...parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
}
