import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import zlib from 'node:zlib'
import { imagePackagesDir, tempDir } from '../database/paths.js'

const DEFAULT_JAVA_VERSION = '17'
const DEFAULT_BASE_IMAGE = 'eclipse-temurin:17-jre-alpine'
const DEFAULT_JAVA_OPTS = '-Xms512m -Xmx1024m -XX:+UseG1GC -XX:MaxGCPauseMillis=200'
const MAX_LOG_CHARS = 80000

/**
 * 根据用户选择的 Jar 包生成 Docker 镜像压缩包。
 * 当前只做本地构建和 docker save，不执行服务器上传。
 */
export async function buildImagePackage(input = {}) {
  const startedAt = Date.now()
  const logs = []
  let buildDir = ''
  let tarPath = ''

  try {
    const config = await normalizeBuildInput(input)
    const buildId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    buildDir = path.join(tempDir, `image-build-${buildId}`)
    const dockerfileText = createDockerfile(config)
    const outputFileName = `${toSafeFilePart(config.imageName)}_${toSafeFilePart(config.imageTag)}_${buildId}.tar.gz`
    const outputPath = path.join(imagePackagesDir, outputFileName)

    appendLog(logs, `准备构建镜像 ${config.imageRef}`)
    await fs.mkdir(buildDir, { recursive: true })
    await fs.mkdir(imagePackagesDir, { recursive: true })

    await fs.copyFile(config.jarPath, path.join(buildDir, 'app.jar'))
    await fs.writeFile(path.join(buildDir, 'Dockerfile'), dockerfileText, 'utf8')
    appendLog(logs, `已生成临时 Dockerfile: ${buildDir}`)

    await runCommand('docker', ['--version'], { logs })
    await runCommand('docker', ['build', '-t', config.imageRef, '.'], {
      cwd: buildDir,
      logs,
    })

    tarPath = path.join(buildDir, `${toSafeFilePart(config.imageName)}_${toSafeFilePart(config.imageTag)}.tar`)
    await runCommand('docker', ['save', config.imageRef, '-o', tarPath], { logs })

    appendLog(logs, '正在压缩镜像包')
    await gzipFile(tarPath, outputPath)
    const packageStat = await fs.stat(outputPath)
    appendLog(logs, `镜像包已生成: ${outputPath}`)

    await fs.rm(buildDir, { recursive: true, force: true })

    return {
      ok: true,
      status: 'success',
      message: '镜像压缩包生成成功',
      ...config,
      jarName: path.basename(config.jarPath),
      packagePath: outputPath,
      packageFileName: outputFileName,
      packageSizeBytes: packageStat.size,
      dockerfileText,
      durationMs: Date.now() - startedAt,
      logs,
    }
  } catch (error) {
    appendLog(logs, error?.message || String(error))

    if (buildDir) {
      await fs.rm(buildDir, { recursive: true, force: true }).catch(() => {})
    }

    return {
      ok: false,
      status: 'failed',
      message: error?.message || '镜像压缩包生成失败',
      ...safeFailureConfig(input),
      packagePath: '',
      packageFileName: '',
      packageSizeBytes: 0,
      dockerfileText: '',
      durationMs: Date.now() - startedAt,
      logs,
    }
  } finally {
    if (tarPath) {
      await fs.rm(tarPath, { force: true }).catch(() => {})
    }
  }
}

/**
 * 根据当前表单生成 Dockerfile 预览，不触发构建。
 */
export function previewImagePackage(input = {}) {
  const config = normalizeBuildInputSync(input)
  return {
    ...config,
    jarName: config.jarPath ? path.basename(config.jarPath) : '',
    dockerfileText: createDockerfile(config),
  }
}

async function normalizeBuildInput(input) {
  const config = normalizeBuildInputSync(input)
  const stat = await fs.stat(config.jarPath).catch(() => null)

  if (!stat?.isFile()) {
    throw new Error('请选择一个有效的 Jar 文件')
  }

  if (path.extname(config.jarPath).toLowerCase() !== '.jar') {
    throw new Error('当前只支持 .jar 文件')
  }

  return config
}

function normalizeBuildInputSync(input) {
  const jarPath = String(input.jarPath || '').trim()
  const serviceName = String(input.serviceName || '').trim()
  const serviceVersion = String(input.serviceVersion || '').trim()
  const servicePort = Number(input.servicePort || 0)
  const javaVersion = normalizeJavaVersion(input.javaVersion)
  const imageName = normalizeImageName(serviceName)
  const imageTag = normalizeImageTag(serviceVersion)
  const javaOpts = String(input.javaOpts || DEFAULT_JAVA_OPTS).trim() || DEFAULT_JAVA_OPTS
  const useNonRootUser = input.useNonRootUser !== false
  const appUser = normalizeUserName(input.appUser)
  const baseImage =
    String(input.baseImage || '').trim() || buildDefaultBaseImage(javaVersion, useNonRootUser)

  if (!jarPath) {
    throw new Error('请选择 Jar 包')
  }

  if (!serviceName) {
    throw new Error('请填写服务名')
  }

  if (!imageName) {
    throw new Error('服务名需要包含英文或数字，才能作为 Docker 镜像名')
  }

  if (!serviceVersion) {
    throw new Error('请填写服务版本')
  }

  if (!imageTag) {
    throw new Error('服务版本只能包含英文、数字、点、下划线或短横线')
  }

  if (!Number.isInteger(servicePort) || servicePort < 1 || servicePort > 65535) {
    throw new Error('启动端口必须是 1 到 65535 之间的整数')
  }

  return {
    jarPath,
    serviceName,
    serviceVersion,
    servicePort,
    javaVersion,
    imageName,
    imageTag,
    imageRef: `${imageName}:${imageTag}`,
    javaOpts,
    baseImage,
    useNonRootUser,
    appUser,
  }
}

function createDockerfile(config) {
  const userBlock = config.useNonRootUser
    ? `RUN addgroup -S ${config.appUser} && adduser -S ${config.appUser} -G ${config.appUser}

WORKDIR /app

COPY --chown=${config.appUser}:${config.appUser} app.jar app.jar

USER ${config.appUser}
`
    : `WORKDIR /app

COPY app.jar app.jar
`

  return `FROM ${config.baseImage}

${userBlock}

ENV SERVER_PORT=${config.servicePort}
ENV JAVA_OPTS="${escapeDockerEnv(config.javaOpts)}"

EXPOSE ${config.servicePort}

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar --server.port=$SERVER_PORT"]
`
}

function runCommand(command, args, options = {}) {
  const cwd = options.cwd || undefined
  const logs = options.logs || []
  const displayCommand = [command, ...args].join(' ')

  appendLog(logs, `$ ${displayCommand}`)

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      const text = data.toString()
      stdout += text
      appendProcessOutput(logs, text)
    })

    child.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text
      appendProcessOutput(logs, text)
    })

    child.on('error', (error) => {
      reject(new Error(`执行 ${command} 失败: ${error.message}`))
    })

    child.on('close', (code, signal) => {
      if (code === 0 && !signal) {
        resolve({ stdout, stderr })
        return
      }

      reject(
        new Error(
          `${displayCommand} 执行失败，退出码 ${code ?? '-'}${signal ? `，信号 ${signal}` : ''}`,
        ),
      )
    })
  })
}

async function gzipFile(sourcePath, targetPath) {
  await pipeline(
    createReadStream(sourcePath),
    zlib.createGzip({ level: 9 }),
    createWriteStream(targetPath),
  )
}

function normalizeImageName(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/\/+/g, '/')
    .split('/')
    .map((part) => part.replace(/^[._-]+|[._-]+$/g, '').replace(/[._-]{2,}/g, '-'))
    .filter(Boolean)
    .join('/')

  return normalized.slice(0, 180)
}

function normalizeImageTag(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 128)
}

function toSafeFilePart(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120)
}

function escapeDockerEnv(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function normalizeJavaVersion(value) {
  const version = String(value || DEFAULT_JAVA_VERSION).trim()

  return version === '21' ? '21' : '17'
}

function normalizeUserName(value) {
  const userName = String(value || 'spring')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')

  return userName || 'spring'
}

function buildDefaultBaseImage(javaVersion, useNonRootUser) {
  const version = normalizeJavaVersion(javaVersion)

  if (version === '21') {
    return useNonRootUser ? 'eclipse-temurin:21-jre-alpine' : 'eclipse-temurin:21-jre-alpine'
  }

  return DEFAULT_BASE_IMAGE
}

function appendLog(logs, message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logs.push(`[${time}] ${message}`)
  trimLogs(logs)
}

function appendProcessOutput(logs, output) {
  const lines = output.replace(/\r\n/g, '\n').split('\n')

  for (const line of lines) {
    if (line) {
      logs.push(line)
    }
  }

  trimLogs(logs)
}

function trimLogs(logs) {
  let size = logs.join('\n').length

  while (size > MAX_LOG_CHARS && logs.length > 1) {
    const removed = logs.shift()
    size -= String(removed || '').length + 1
  }
}

function safeFailureConfig(input) {
  const serviceName = String(input.serviceName || '').trim()
  const serviceVersion = String(input.serviceVersion || '').trim()
  const servicePort = Number(input.servicePort || 0)
  const javaVersion = normalizeJavaVersion(input.javaVersion)
  const useNonRootUser = input.useNonRootUser !== false
  const appUser = normalizeUserName(input.appUser)
  const imageName = normalizeImageName(serviceName)
  const imageTag = normalizeImageTag(serviceVersion)

  return {
    jarPath: String(input.jarPath || '').trim(),
    serviceName,
    serviceVersion,
    servicePort: Number.isInteger(servicePort) ? servicePort : 0,
    javaVersion,
    imageName,
    imageTag,
    imageRef: imageName && imageTag ? `${imageName}:${imageTag}` : '',
    javaOpts: String(input.javaOpts || DEFAULT_JAVA_OPTS).trim() || DEFAULT_JAVA_OPTS,
    baseImage:
      String(input.baseImage || '').trim() || buildDefaultBaseImage(javaVersion, useNonRootUser),
    useNonRootUser,
    appUser,
    jarName: input.jarPath ? path.basename(String(input.jarPath)) : '',
  }
}
