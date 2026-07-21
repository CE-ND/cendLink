import fs from 'node:fs/promises'
import path from 'node:path'
import ssh2 from 'ssh2'
import {
  analyzeNginxProxyConfig,
  buildNginxProxyTarget,
  normalizeNginxContainerName,
  resolveDockerNetworkConfig,
} from '../../../src/shared/nginxDeployment.js'
import { normalizeConnectionInput, toSshConfig } from '../ssh/sshClient.js'

const { Client } = ssh2

const DEFAULT_REMOTE_BASE_DIR = '/mnt/temp_check'
const DEFAULT_REMOTE_PACKAGE_DIR = '/opt/cendlink/packages'
const DEFAULT_RESTART_POLICY = 'unless-stopped'
const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const DEFAULT_MOUNT_TARGETS = [
  { key: 'logs', containerPath: '/app/logs' },
  { key: 'uploads', containerPath: '/app/uploads' },
  { key: 'config', containerPath: '/app/config' },
]
const PORT_CHECK_DOCKER_MARKER = '__CENDLINK_DOCKER_PORT_MATCHES__'
const PORT_CHECK_LISTENER_MARKER = '__CENDLINK_HOST_PORT_LISTENERS__'

/**
 * 执行一条完整的远程部署流水：
 * - 上传镜像包
 * - docker load
 * - 创建运行目录
 * - 处理旧容器
 * - docker run
 * - 清理旧镜像（可选）
 */
export async function runDeployment(connectionInput, deploymentInput = {}) {
  const startedAt = Date.now()
  const normalizedConnection = await normalizeConnectionInput(connectionInput)
  const normalized = await normalizeDeploymentInput(deploymentInput)
  const logs = []
  const steps = []
  const warnings = []
  let nginxDiagnostics = createEmptyNginxDiagnostics(normalized)

  appendLog(logs, `开始部署 ${normalized.imageRef} -> ${normalized.containerName}`)

  const sshConfig = await toSshConfig(normalizedConnection)
  const client = new Client()

  try {
    await connectClient(client, sshConfig, logs)
    const sftp = await openSftp(client)

    const remotePackageDir = normalized.remotePackageDir
    const remotePackagePath = buildRemotePackagePath(remotePackageDir, normalized.localPackagePath)

    await runStep({
      logs,
      steps,
      name: '远程预检查',
      command: `mkdir -p ${shellQuote(remotePackageDir)}`,
      runner: async () => {
        await execCommand(client, `mkdir -p ${shellQuote(remotePackageDir)}`)
        await execCommand(client, 'docker --version')
      },
    })

    await runStep({
      logs,
      steps,
      name: '检查 Docker 网络',
      command: buildNetworkInspectCommand(normalized.networkName),
      runner: async () => execCommand(client, buildNetworkInspectCommand(normalized.networkName)),
    })

    if (normalized.nginxProxyCheckEnabled) {
      const diagnosticResult = await runDiagnosticStep({
        logs,
        steps,
        name: '检查 Nginx 代理',
        command: buildNginxDiagnosticLogCommand(normalized),
        runner: async () => inspectNginxProxy(client, normalized),
      })
      warnings.push(...diagnosticResult.warnings)
      nginxDiagnostics = diagnosticResult.diagnostics || nginxDiagnostics
    } else {
      appendSkippedStep({
        logs,
        steps,
        name: '检查 Nginx 代理',
        message: '未启用 Nginx 代理检查',
      })
    }

    await runStep({
      logs,
      steps,
      name: '检查端口占用',
      command: buildPortCheckLogCommand(normalized.hostPort),
      runner: async () => {
        return checkPortAvailability(client, normalized)
      },
    })

    await runStep({
      logs,
      steps,
      name: '上传镜像包',
      command: `upload ${normalized.localPackagePath} -> ${remotePackagePath}`,
      runner: async () => {
        await uploadFile(sftp, normalized.localPackagePath, remotePackagePath)
      },
    })

    const loadResult = await runStep({
      logs,
      steps,
      name: '导入镜像',
      command: `docker load -i ${shellQuote(remotePackagePath)}`,
      runner: async () => {
        return execCommand(client, `docker load -i ${shellQuote(remotePackagePath)}`)
      },
    })

    const resolvedImageRef = extractLoadedImageRef(loadResult.stdout) || normalized.imageRef
    const remoteReleaseDir = normalized.remoteReleaseDir
    const mkdirCommand = buildMkdirCommand(remoteReleaseDir, normalized.mounts)

    await runStep({
      logs,
      steps,
      name: '创建运行目录',
      command: mkdirCommand,
      runner: async () => {
        await execCommand(client, mkdirCommand)

        if (normalized.directoryPermissionMode === 'chmod777') {
          const chmodCommand = `chmod -R 777 ${shellQuote(remoteReleaseDir)}`
          await execCommand(client, chmodCommand)
          appendLog(logs, `已应用目录权限策略: ${chmodCommand}`)
        }
      },
    })

    const containerExists = await detectContainer(client, normalized.containerName)

    if (containerExists) {
      if (normalized.containerConflictStrategy === 'abort') {
        throw new Error(`检测到同名容器 ${normalized.containerName}，当前策略为终止部署`)
      }

      if (normalized.containerConflictStrategy === 'confirm') {
        throw new Error(`检测到同名容器 ${normalized.containerName}，当前版本暂未实现手动确认流程，请改用自动替换或终止策略`)
      }

      if (normalized.containerConflictStrategy === 'auto') {
        await runStep({
          logs,
          steps,
          name: '替换旧容器',
          command: `docker rm -f ${shellQuote(normalized.containerName)}`,
          runner: async () => {
            await execCommand(client, `docker rm -f ${shellQuote(normalized.containerName)}`)
          },
        })
      }
    }

    const runCommand = buildDockerRunCommand({
      ...normalized,
      imageRef: resolvedImageRef,
      remoteReleaseDir,
    })

    const runResult = await runStep({
      logs,
      steps,
      name: '启动容器',
      command: runCommand,
      runner: async () => {
        return execCommand(client, runCommand)
      },
    })

    const containerId = runResult.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || ''

    const inspectResult = await runStep({
      logs,
      steps,
      name: '检查容器状态',
      command: `docker ps --filter name=^/${normalized.containerName}$ --format "{{.ID}}|{{.Image}}|{{.Status}}|{{.Ports}}"`,
      runner: async () => {
        return execCommand(
          client,
          `docker ps --filter name=^/${normalized.containerName}$ --format "{{.ID}}|{{.Image}}|{{.Status}}|{{.Ports}}"`,
        )
      },
    })

    await runStep({
      logs,
      steps,
      name: '验证容器网络',
      command: buildContainerNetworkInspectCommand(normalized.containerName),
      runner: async () => verifyContainerNetwork(client, normalized),
    })

    const imageCleanup = await cleanupOldImages(client, normalized, resolvedImageRef, logs, steps)

    return {
      ok: true,
      status: 'success',
      message: warnings.length ? `部署成功，存在 ${warnings.length} 个 Nginx 警告` : '部署成功',
      imageRef: resolvedImageRef,
      containerId,
      containerName: normalized.containerName,
      localPackagePath: normalized.localPackagePath,
      remotePackagePath,
      remoteReleaseDir,
      runCommand,
      cleanupCommand: imageCleanup.command,
      cleanupSummary: imageCleanup.summary,
      networkName: normalized.networkName,
      nginxProxyCheckEnabled: normalized.nginxProxyCheckEnabled,
      nginxContainerName: normalized.nginxContainerName,
      nginxProxyTarget: normalized.nginxProxyTarget,
      warnings,
      nginxDiagnostics,
      steps,
      logs,
      inspectOutput: inspectResult.stdout.trim(),
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      deployConfig: normalized,
    }
  } catch (error) {
    appendLog(logs, error?.message || String(error))

    return {
      ok: false,
      status: 'failed',
      message: error?.message || '部署失败',
      imageRef: normalized.imageRef,
      containerId: '',
      containerName: normalized.containerName,
      localPackagePath: normalized.localPackagePath,
      remotePackagePath: '',
      remoteReleaseDir: normalized.remoteReleaseDir,
      runCommand: buildDockerRunCommand(normalized),
      cleanupCommand: '',
      cleanupSummary: '',
      networkName: normalized.networkName,
      nginxProxyCheckEnabled: normalized.nginxProxyCheckEnabled,
      nginxContainerName: normalized.nginxContainerName,
      nginxProxyTarget: normalized.nginxProxyTarget,
      warnings,
      nginxDiagnostics,
      steps,
      logs,
      inspectOutput: '',
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      deployConfig: normalized,
    }
  } finally {
    client.end()
  }
}

/**
 * 仅根据当前表单预览部署计划，不连接远程服务器。
 */
export async function previewDeployment(deploymentInput = {}) {
  const normalized = await normalizeDeploymentInput(deploymentInput)

  return {
    ...normalized,
    runCommand: buildDockerRunCommand(normalized),
    nginxProxyTarget: normalized.nginxProxyTarget,
    mkdirCommand: buildMkdirCommand(normalized.remoteReleaseDir, normalized.mounts),
    remotePackagePath: buildRemotePackagePath(normalized.remotePackageDir, normalized.localPackagePath),
  }
}

async function normalizeDeploymentInput(input = {}) {
  const localPackagePath = String(input.localPackagePath || input.packagePath || '').trim()
  const serviceName = normalizeName(input.serviceName || inferServiceName(localPackagePath))
  const serviceVersion = String(input.serviceVersion || inferServiceVersion(localPackagePath) || '1.0.0').trim()
  const imageName = normalizeImageName(input.imageName || serviceName)
  const imageTag = normalizeImageTag(input.imageTag || serviceVersion)
  const imageRef = `${imageName}:${imageTag}`
  const containerName = normalizeName(input.containerName || imageName)
  const containerPort = normalizePort(input.containerPort || input.servicePort || inferContainerPort(input))
  const hostPort = normalizePort(input.hostPort || containerPort)
  const remoteBaseDir = String(input.remoteBaseDir || DEFAULT_REMOTE_BASE_DIR).trim() || DEFAULT_REMOTE_BASE_DIR
  const remotePackageDir =
    String(input.remotePackageDir || DEFAULT_REMOTE_PACKAGE_DIR).trim() || DEFAULT_REMOTE_PACKAGE_DIR
  const releaseFolderName =
    String(input.releaseFolderName || '').trim() ||
    buildReleaseFolderName(serviceName, serviceVersion, input.releaseDate || new Date())
  const remoteReleaseDir = joinUnix(remoteBaseDir, releaseFolderName)
  const restartPolicy = String(input.restartPolicy || DEFAULT_RESTART_POLICY).trim() || DEFAULT_RESTART_POLICY
  const envVars = normalizeEnvVars(input.envVars)
  const mounts = normalizeMounts(input.mounts, remoteReleaseDir)
  const networkConfig = resolveDockerNetworkConfig({
    networkName: input.networkName,
    extraArgs: input.extraArgs,
  })
  const networkName = networkConfig.networkName
  const nginxProxyCheckEnabled = input.nginxProxyCheckEnabled !== false
  const nginxContainerName = nginxProxyCheckEnabled
    ? normalizeNginxContainerName(input.nginxContainerName)
    : ''
  const nginxProxyTarget = nginxProxyCheckEnabled
    ? buildNginxProxyTarget(containerName, containerPort)
    : ''
  const extraArgs = networkConfig.extraArgs
  const containerConflictStrategy = normalizeContainerStrategy(input.containerConflictStrategy)
  const imageCleanupStrategy = normalizeImageCleanupStrategy(input.imageCleanupStrategy)
  const directoryPermissionMode = normalizeDirectoryPermissionMode(input.directoryPermissionMode)

  if (!localPackagePath) {
    throw new Error('请选择镜像包 tar.gz 文件')
  }

  const stat = await fs.stat(localPackagePath).catch(() => null)

  if (!stat?.isFile()) {
    throw new Error('镜像包文件不存在')
  }

  if (!imageName) {
    throw new Error('请填写镜像名')
  }

  if (!containerName) {
    throw new Error('请填写容器名')
  }

  if (!hostPort || !containerPort) {
    throw new Error('请填写宿主机端口和容器端口')
  }

  return {
    localPackagePath,
    localPackageName: path.basename(localPackagePath),
    serviceName,
    serviceVersion,
    imageName,
    imageTag,
    imageRef,
    containerName,
    hostPort,
    containerPort,
    remoteBaseDir,
    remotePackageDir,
    releaseFolderName,
    remoteReleaseDir,
    restartPolicy,
    envVars,
    mounts,
    networkName,
    nginxProxyCheckEnabled,
    nginxContainerName,
    nginxProxyTarget,
    extraArgs,
    containerConflictStrategy,
    imageCleanupStrategy,
    directoryPermissionMode,
  }
}

export function buildDockerRunCommand(config) {
  const parts = [
    'docker run -d',
    `--name ${shellQuote(config.containerName)}`,
    `-p ${config.hostPort}:${config.containerPort}`,
  ]

  for (const item of config.envVars) {
    parts.push(`-e ${shellQuote(`${item.key}=${item.value}`)}`)
  }

  for (const item of config.mounts) {
    parts.push(`-v ${shellQuote(`${item.hostPath}:${item.containerPath}`)}`)
  }

  if (config.restartPolicy) {
    parts.push(`--restart=${config.restartPolicy}`)
  }

  if (config.networkName) {
    parts.push(`--network ${shellQuote(config.networkName)}`)
  }

  if (config.extraArgs) {
    parts.push(config.extraArgs)
  }

  parts.push(config.imageRef)

  return parts.join(' ')
}

function buildMkdirCommand(remoteReleaseDir, mounts) {
  const directoryArgs = [remoteReleaseDir, ...mounts.map((item) => item.hostPath)].map(shellQuote)
  return `mkdir -p ${directoryArgs.join(' ')}`
}

function buildRemotePackagePath(remotePackageDir, localPackagePath) {
  return joinUnix(remotePackageDir, path.basename(localPackagePath))
}

function buildReleaseFolderName(serviceName, serviceVersion, inputDate) {
  const date = inputDate instanceof Date ? inputDate : new Date(inputDate)
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')

  return `${yyyy}_${mm}_${dd}_${serviceName}-${serviceVersion}`
}

async function connectClient(client, sshConfig, logs) {
  await new Promise((resolve, reject) => {
    client
      .on('ready', () => {
        appendLog(logs, 'SSH 连接成功，开始执行部署')
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

async function runDiagnosticStep({ logs, steps, name, command, runner }) {
  const startedAt = Date.now()
  appendLog(logs, `[${name}] ${command}`)

  try {
    const result = await runner()
    const warnings = Array.isArray(result?.warnings) ? result.warnings : []
    const step = {
      name,
      status: warnings.length ? 'warning' : 'success',
      command,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      stdout: result?.stdout || '',
      stderr: '',
      message: warnings.length ? warnings.map((warning) => warning.message).join(' | ') : '检查通过',
    }

    steps.push(step)
    appendLog(logs, warnings.length ? `${name} 完成，发现 ${warnings.length} 个警告` : `${name} 通过`)
    warnings.forEach((warning) => appendLog(logs, `[警告] ${warning.message}`))

    return {
      ...result,
      warnings,
    }
  } catch (error) {
    const warning = {
      code: 'NGINX_DIAGNOSTIC_FAILED',
      message: `无法完成 Nginx 代理检查: ${error?.message || String(error)}`,
    }
    const step = {
      name,
      status: 'warning',
      command,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      stdout: '',
      stderr: error?.message || String(error),
      message: warning.message,
    }

    steps.push(step)
    appendLog(logs, `[警告] ${warning.message}`)

    return {
      warnings: [warning],
      diagnostics: null,
      stdout: '',
    }
  }
}

function appendSkippedStep({ logs, steps, name, message }) {
  const now = new Date().toISOString()
  steps.push({
    name,
    status: 'skipped',
    command: '',
    exitCode: 0,
    durationMs: 0,
    startedAt: now,
    finishedAt: now,
    stdout: '',
    stderr: '',
    message,
  })
  appendLog(logs, `[${name}] ${message}`)
}

async function inspectNginxProxy(client, config) {
  const diagnostics = createEmptyNginxDiagnostics(config)
  const warnings = []
  let inspectResult

  try {
    inspectResult = await execCommand(client, `docker inspect ${shellQuote(config.nginxContainerName)}`)
  } catch {
    warnings.push({
      code: 'NGINX_NOT_FOUND',
      message: `未找到 Nginx 容器 ${config.nginxContainerName}，无法校验代理配置`,
    })
    return buildNginxDiagnosticResult(diagnostics, warnings)
  }

  const inspect = parseDockerInspectResult(inspectResult.stdout)
  diagnostics.containerFound = true
  diagnostics.containerRunning = Boolean(inspect?.State?.Running)
  diagnostics.networks = Object.keys(inspect?.NetworkSettings?.Networks || {})
  diagnostics.sharesNetwork = diagnostics.networks.includes(config.networkName)

  if (!diagnostics.containerRunning) {
    warnings.push({
      code: 'NGINX_NOT_RUNNING',
      message: `Nginx 容器 ${config.nginxContainerName} 当前未运行，无法读取生效配置`,
    })
  }

  if (!diagnostics.sharesNetwork) {
    warnings.push({
      code: 'NGINX_NETWORK_MISMATCH',
      message: `Nginx 容器 ${config.nginxContainerName} 未加入网络 ${config.networkName}，无法通过容器名访问后端`,
      expected: config.networkName,
      actual: diagnostics.networks.join(', ') || '无网络',
    })
  }

  if (!diagnostics.containerRunning) {
    return buildNginxDiagnosticResult(diagnostics, warnings)
  }

  try {
    const configResult = await execCommand(
      client,
      `docker exec ${shellQuote(config.nginxContainerName)} nginx -T`,
    )
    const nginxConfig = [configResult.stdout, configResult.stderr].filter(Boolean).join('\n')
    const proxyAnalysis = analyzeNginxProxyConfig(nginxConfig, {
      containerName: config.containerName,
      containerPort: config.containerPort,
    })

    diagnostics.configReadable = true
    diagnostics.proxy = proxyAnalysis

    if (proxyAnalysis.status === 'mismatch') {
      const actual = proxyAnalysis.mismatches
        .map((item) => `${item.host}:${item.port}`)
        .join(', ')
      warnings.push({
        code: 'NGINX_PROXY_PORT_MISMATCH',
        message: `Nginx 正在代理 ${actual}，容器间访问应使用 ${config.containerName}:${config.containerPort}`,
        expected: config.nginxProxyTarget,
        actual,
      })
    } else if (proxyAnalysis.status === 'missing') {
      warnings.push({
        code: 'NGINX_PROXY_MISSING',
        message: `Nginx 生效配置中未找到指向 ${config.containerName} 的代理规则`,
        expected: config.nginxProxyTarget,
      })
    } else if (proxyAnalysis.status === 'unverifiable') {
      warnings.push({
        code: 'NGINX_PROXY_UNVERIFIABLE',
        message: `Nginx 代理使用变量或无法解析的目标，请人工确认应指向 ${config.nginxProxyTarget}`,
        expected: config.nginxProxyTarget,
        actual: proxyAnalysis.unverifiable.join(', '),
      })
    }
  } catch (error) {
    warnings.push({
      code: 'NGINX_CONFIG_UNREADABLE',
      message: `无法读取 Nginx 生效配置: ${error?.message || String(error)}`,
    })
  }

  return buildNginxDiagnosticResult(diagnostics, warnings)
}

async function verifyContainerNetwork(client, config) {
  const command = buildContainerNetworkInspectCommand(config.containerName)
  const result = await execCommand(client, command)
  const networks = JSON.parse(String(result.stdout || '{}').trim() || '{}')

  if (!Object.prototype.hasOwnProperty.call(networks, config.networkName)) {
    throw new Error(`容器 ${config.containerName} 未加入目标网络 ${config.networkName}`)
  }

  return {
    stdout: `容器 ${config.containerName} 已加入网络 ${config.networkName}；Nginx 代理目标 ${config.nginxProxyTarget}`,
    stderr: '',
  }
}

function createEmptyNginxDiagnostics(config) {
  return {
    enabled: config.nginxProxyCheckEnabled,
    containerName: config.nginxContainerName,
    expectedNetwork: config.networkName,
    expectedProxyTarget: config.nginxProxyTarget,
    containerFound: false,
    containerRunning: false,
    networks: [],
    sharesNetwork: false,
    configReadable: false,
    proxy: null,
  }
}

function buildNginxDiagnosticResult(diagnostics, warnings) {
  return {
    diagnostics,
    warnings,
    stdout: warnings.length
      ? warnings.map((warning) => warning.message).join('\n')
      : `Nginx 代理配置与 ${diagnostics.expectedProxyTarget} 一致`,
    stderr: '',
  }
}

function parseDockerInspectResult(output) {
  const parsed = JSON.parse(String(output || '[]'))
  return Array.isArray(parsed) ? parsed[0] : parsed
}

function buildNetworkInspectCommand(networkName) {
  return `docker network inspect ${shellQuote(networkName)} --format '{{.Name}}'`
}

function buildContainerNetworkInspectCommand(containerName) {
  return `docker inspect ${shellQuote(containerName)} --format '{{json .NetworkSettings.Networks}}'`
}

function buildNginxDiagnosticLogCommand(config) {
  return `docker inspect ${shellQuote(config.nginxContainerName)} && docker exec ${shellQuote(config.nginxContainerName)} nginx -T`
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

async function detectContainer(client, containerName) {
  const result = await execCommand(
    client,
    `docker ps -a --filter name=^/${containerName}$ --format "{{.Names}}" || true`,
  )

  return result.stdout.trim().split(/\r?\n/).includes(containerName)
}

async function checkPortAvailability(client, config) {
  const result = await execCommand(client, buildPortCheckCommand(config.hostPort))
  const usage = parsePortCheckOutput(result.stdout)
  const sameContainerMatches = usage.dockerMatches.filter((item) => item.name === config.containerName)
  const otherDockerMatches = usage.dockerMatches.filter((item) => item.name !== config.containerName)

  if (otherDockerMatches.length) {
    const names = otherDockerMatches.map((item) => item.name).join('、')
    throw new Error(`端口 ${config.hostPort} 已被容器 ${names} 占用，请更换宿主机端口或先释放该容器`)
  }

  if (sameContainerMatches.length) {
    if (config.containerConflictStrategy === 'auto') {
      return {
        stdout: `端口 ${config.hostPort} 当前由待替换容器 ${config.containerName} 使用，自动替换策略允许继续`,
        stderr: '',
      }
    }

    throw new Error(`端口 ${config.hostPort} 已由同名容器 ${config.containerName} 占用，请改为自动替换或更换宿主机端口`)
  }

  if (usage.listenerLines.length) {
    throw new Error(`端口 ${config.hostPort} 已被远程主机进程占用: ${summarizePortListeners(usage.listenerLines)}`)
  }

  return {
    stdout: `端口 ${config.hostPort} 未检测到占用`,
    stderr: '',
  }
}

async function cleanupOldImages(client, config, currentImageRef, logs, steps) {
  if (config.imageCleanupStrategy !== 'auto') {
    return {
      command: '',
      summary: config.imageCleanupStrategy === 'keep' ? '保留旧镜像' : '待确认清理旧镜像',
    }
  }

  const queryCommand = `docker images ${shellQuote(config.imageName)} --format "{{.Repository}}:{{.Tag}}" || true`
  const queryResult = await runStep({
    logs,
    steps,
    name: '扫描旧镜像',
    command: queryCommand,
    runner: async () => {
      return execCommand(client, queryCommand)
    },
  })

  const candidates = queryResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((item) => item !== currentImageRef)

  if (!candidates.length) {
    return {
      command: '',
      summary: '没有可清理的旧镜像',
    }
  }

  const deleteCommand = `docker rmi ${candidates.map(shellQuote).join(' ')}`
  await runStep({
    logs,
    steps,
    name: '清理旧镜像',
    command: deleteCommand,
    runner: async () => {
      return execCommand(client, deleteCommand)
    },
  })

  return {
    command: deleteCommand,
    summary: `已清理 ${candidates.length} 个旧镜像`,
  }
}

function extractLoadedImageRef(output) {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const match = line.match(/^Loaded image:\s+(.+)$/i)

    if (match) {
      return match[1].trim()
    }
  }

  return ''
}

function normalizeEnvVars(input) {
  const values = Array.isArray(input)
    ? input
    : String(input || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf('=')
          return {
            key: index >= 0 ? line.slice(0, index).trim() : line.trim(),
            value: index >= 0 ? line.slice(index + 1).trim() : '',
          }
        })

  const normalized = values
    .map((item) => ({
      key: String(item?.key || '').trim(),
      value: String(item?.value || '').trim(),
    }))
    .filter((item) => item.key)

  if (!normalized.find((item) => item.key === 'TZ')) {
    normalized.push({ key: 'TZ', value: DEFAULT_TIMEZONE })
  }

  return normalized
}

function normalizeMounts(input, remoteReleaseDir) {
  const values = Array.isArray(input) ? input : []

  if (!values.length) {
    return DEFAULT_MOUNT_TARGETS.map((item) => ({
      key: item.key,
      hostPath: joinUnix(remoteReleaseDir, item.key),
      containerPath: item.containerPath,
    }))
  }

  return values
    .map((item) => ({
      key: String(item?.key || '').trim(),
      hostPath: String(item?.hostPath || '').trim(),
      containerPath: String(item?.containerPath || '').trim(),
    }))
    .filter((item) => item.hostPath && item.containerPath)
}

function normalizeContainerStrategy(value) {
  return value === 'abort' ? 'abort' : value === 'confirm' ? 'confirm' : 'auto'
}

function normalizeImageCleanupStrategy(value) {
  return value === 'keep' ? 'keep' : value === 'confirm' ? 'confirm' : 'auto'
}

function normalizeDirectoryPermissionMode(value) {
  return value === 'chmod777' ? 'chmod777' : 'none'
}

function normalizePort(value) {
  const port = Number(value || 0)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function normalizeImageName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '_')
    .replace(/^[_./-]+|[_./-]+$/g, '')
}

function normalizeImageTag(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
}

function inferServiceName(localPackagePath) {
  const fileName = path.basename(String(localPackagePath || ''), path.extname(String(localPackagePath || '')))
  return fileName.replace(/\.tar$/i, '').replace(/\.gz$/i, '')
}

function inferServiceVersion(localPackagePath) {
  const fileName = inferServiceName(localPackagePath)
  const match = fileName.match(/(?:-|_)(\d+(?:\.\d+)+(?:[-._][a-zA-Z0-9]+)?)$/)
  return match ? match[1].replace(/_/g, '.') : ''
}

function inferContainerPort(input) {
  return Number(input.containerPort || input.servicePort || input.packageServicePort || 0)
}

function buildPortCheckLogCommand(port) {
  return `docker ps --filter publish=${port} && ss/netstat/lsof :${port}`
}

function buildPortCheckCommand(port) {
  return [
    `PORT=${shellQuote(String(port))}`,
    `echo ${shellQuote(PORT_CHECK_DOCKER_MARKER)}`,
    `docker ps --filter "publish=$PORT" --format "{{.Names}}\t{{.Image}}\t{{.Ports}}" 2>/dev/null || true`,
    `echo ${shellQuote(PORT_CHECK_LISTENER_MARKER)}`,
    `if command -v ss >/dev/null 2>&1; then`,
    `  (ss -ltnp 2>/dev/null || ss -ltn 2>/dev/null) | awk -v port="$PORT" 'NR > 1 && $4 ~ ":" port "$" { print }' || true`,
    `elif command -v netstat >/dev/null 2>&1; then`,
    `  (netstat -ltnp 2>/dev/null || netstat -ltn 2>/dev/null) | awk -v port="$PORT" 'NR > 2 && $4 ~ ":" port "$" { print }' || true`,
    `elif command -v lsof >/dev/null 2>&1; then`,
    `  lsof -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null || true`,
    `fi`,
  ].join('\n')
}

function parsePortCheckOutput(output = '') {
  const dockerLines = []
  const listenerLines = []
  let section = ''

  for (const rawLine of String(output || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()

    if (!line) {
      continue
    }

    if (line === PORT_CHECK_DOCKER_MARKER) {
      section = 'docker'
      continue
    }

    if (line === PORT_CHECK_LISTENER_MARKER) {
      section = 'listener'
      continue
    }

    if (section === 'docker') {
      dockerLines.push(line)
    }

    if (section === 'listener' && !isPortListenerHeader(line)) {
      listenerLines.push(line)
    }
  }

  return {
    dockerMatches: dockerLines.map(parseDockerPortLine).filter((item) => item.name),
    listenerLines,
  }
}

function parseDockerPortLine(line) {
  const [name = '', image = '', ports = ''] = line.split('\t')

  return {
    name: name.trim(),
    image: image.trim(),
    ports: ports.trim(),
  }
}

function isPortListenerHeader(line) {
  return /^COMMAND\s+PID\b/i.test(line) || /^Proto\s+/i.test(line) || /^State\s+/i.test(line)
}

function summarizePortListeners(lines) {
  return lines.slice(0, 2).join(' | ').slice(0, 220)
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

function joinUnix(...parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
}
