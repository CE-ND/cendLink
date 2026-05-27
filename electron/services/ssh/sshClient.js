import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ssh2 from 'ssh2'

const { Client } = ssh2

// 默认 SSH 握手超时时间，前端表单不填或填错时使用。
const DEFAULT_TIMEOUT_MS = 10000
// 命令输出最多返回给渲染进程的字符数，避免超大日志撑爆界面和 IPC。
const MAX_OUTPUT_CHARS = 50000

/**
 * 测试 SSH 连接，并在登录成功后采集远程环境信息。
 * 入参来自连接表单；返回值用于 ConnectionStatus 和 Activity Log 展示。
 */
export async function testSshConnection(input) {
  const startedAt = Date.now()
  const logs = []

  try {
    const normalized = await normalizeConnectionInput(input)
    appendLog(logs, `准备连接 ${normalized.username}@${normalized.host}:${normalized.port}`)

    const connectionConfig = await toSshConfig(normalized)
    const result = await connectAndProbe(connectionConfig, logs)

    return {
      ...result,
      durationMs: Date.now() - startedAt,
      logs,
    }
  } catch (error) {
    appendLog(logs, sanitizeError(error))

    return {
      ok: false,
      status: 'failed',
      message: sanitizeError(error),
      durationMs: Date.now() - startedAt,
      logs,
    }
  }
}

/**
 * 使用当前 SSH 配置执行一条远程 Linux 命令。
 * 返回 stdout、stderr、exitCode、signal、耗时和日志，供命令页和历史记录使用。
 */
export async function executeSshCommand(input, command) {
  const startedAt = Date.now()
  const logs = []

  try {
    const normalized = await normalizeConnectionInput(input)
    const normalizedCommand = normalizeCommand(command)

    appendLog(logs, `准备连接 ${normalized.username}@${normalized.host}:${normalized.port}`)
    appendLog(logs, `准备执行命令: ${summarizeCommand(normalizedCommand)}`)

    const connectionConfig = await toSshConfig(normalized)
    const result = await connectAndExecute(connectionConfig, normalizedCommand, logs)

    return {
      ...result,
      command: normalizedCommand,
      durationMs: Date.now() - startedAt,
      logs,
    }
  } catch (error) {
    appendLog(logs, sanitizeError(error))

    return {
      ok: false,
      status: 'failed',
      command: normalizeCommandFallback(command),
      message: sanitizeError(error),
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
      durationMs: Date.now() - startedAt,
      logs,
    }
  }
}

/**
 * 规范化并校验连接参数。
 * 返回字段说明：
 * - host/port/username：SSH 连接目标。
 * - authType：password 或 privateKey。
 * - password：密码登录时使用，不会写入日志。
 * - privateKeyPath/passphrase：私钥登录时读取本地 PEM/私钥文件。
 * - timeoutMs：ssh2 readyTimeout。
 */
async function normalizeConnectionInput(input = {}) {
  const host = String(input.host || '').trim()
  const username = String(input.username || '').trim()
  const authType = String(input.authType || 'password')
  const port = Number(input.port || 22)
  const timeoutMs = Number(input.timeoutMs || DEFAULT_TIMEOUT_MS)

  if (!host) {
    throw new Error('请填写服务器 Host')
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('端口必须是 1 到 65535 之间的整数')
  }

  if (!username) {
    throw new Error('请填写用户名')
  }

  if (authType !== 'password' && authType !== 'privateKey') {
    throw new Error('认证方式不正确')
  }

  if (authType === 'password' && !String(input.password || '')) {
    throw new Error('请填写登录密码')
  }

  if (authType === 'privateKey' && !String(input.privateKeyPath || '').trim()) {
    throw new Error('请填写私钥文件路径')
  }

  return {
    host,
    port,
    username,
    authType,
    password: String(input.password || ''),
    privateKeyPath: String(input.privateKeyPath || '').trim(),
    passphrase: String(input.passphrase || ''),
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS,
  }
}

/**
 * 校验并清洗远程命令文本。
 */
function normalizeCommand(command) {
  const normalizedCommand = String(command || '').trim()

  if (!normalizedCommand) {
    throw new Error('请输入要执行的 Linux 命令')
  }

  return normalizedCommand
}

/**
 * 异常分支中尽量保留用户原始命令，便于日志和历史记录定位。
 */
function normalizeCommandFallback(command) {
  return String(command || '').trim()
}

/**
 * 把业务配置转换成 ssh2 Client.connect 需要的配置。
 * 密码模式设置 password；私钥模式读取 privateKey 文件内容。
 */
async function toSshConfig(config) {
  const sshConfig = {
    host: config.host,
    port: config.port,
    username: config.username,
    readyTimeout: config.timeoutMs,
    keepaliveInterval: 15000,
  }

  if (config.authType === 'password') {
    sshConfig.password = config.password
    return sshConfig
  }

  const privateKeyPath = expandHome(config.privateKeyPath)
  sshConfig.privateKey = await fs.readFile(privateKeyPath)

  if (config.passphrase) {
    sshConfig.passphrase = config.passphrase
  }

  return sshConfig
}

/**
 * 建立 SSH 连接并执行一组探测命令，用于确认服务器环境。
 */
function connectAndProbe(connectionConfig, logs) {
  return new Promise((resolve) => {
    const client = new Client()
    let settled = false

    const finish = (payload) => {
      if (settled) {
        return
      }

      settled = true
      client.end()
      resolve(payload)
    }

    client
      .on('ready', async () => {
        appendLog(logs, 'SSH 握手成功，正在读取远程环境信息')

        try {
          const remote = await collectRemoteInfo(client)
          appendLog(logs, '远程环境信息读取完成')

          finish({
            ok: true,
            status: 'connected',
            message: '连接成功',
            remote,
          })
        } catch (error) {
          finish({
            ok: false,
            status: 'failed',
            message: `连接成功，但读取远程信息失败：${sanitizeError(error)}`,
          })
        }
      })
      .on('error', (error) => {
        appendLog(logs, 'SSH 连接失败')
        finish({
          ok: false,
          status: 'failed',
          message: sanitizeSshError(error),
        })
      })
      .on('timeout', () => {
        appendLog(logs, 'SSH 连接超时')
        finish({
          ok: false,
          status: 'failed',
          message: '连接超时，请检查服务器地址、端口或防火墙',
        })
      })

    client.connect(connectionConfig)
  })
}

/**
 * 建立 SSH 连接并执行用户输入的单条命令。
 */
function connectAndExecute(connectionConfig, command, logs) {
  return new Promise((resolve) => {
    const client = new Client()
    let settled = false

    const finish = (payload) => {
      if (settled) {
        return
      }

      settled = true
      client.end()
      resolve(payload)
    }

    client
      .on('ready', () => {
        appendLog(logs, 'SSH 握手成功，正在执行远程命令')

        client.exec(command, (error, stream) => {
          if (error) {
            finish({
              ok: false,
              status: 'failed',
              message: `命令启动失败：${sanitizeError(error)}`,
              stdout: '',
              stderr: '',
              exitCode: null,
              signal: null,
            })
            return
          }

          let stdout = ''
          let stderr = ''

          stream
            .on('close', (code, signal) => {
              const exitCode = Number.isInteger(code) ? code : null
              const normalizedSignal = signal || null
              const succeeded = (exitCode ?? 0) === 0 && !normalizedSignal

              appendLog(
                logs,
                succeeded
                  ? '命令执行完成'
                  : `命令执行结束，退出码 ${exitCode ?? '-'}${normalizedSignal ? `，信号 ${normalizedSignal}` : ''}`,
              )

              finish({
                ok: succeeded,
                status: succeeded ? 'completed' : 'failed',
                message: succeeded
                  ? '命令执行成功'
                  : buildCommandFailureMessage(exitCode, normalizedSignal),
                stdout: trimOutput(stdout),
                stderr: trimOutput(stderr),
                exitCode,
                signal: normalizedSignal,
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
      .on('error', (error) => {
        appendLog(logs, 'SSH 连接失败')
        finish({
          ok: false,
          status: 'failed',
          message: sanitizeSshError(error),
          stdout: '',
          stderr: '',
          exitCode: null,
          signal: null,
        })
      })
      .on('timeout', () => {
        appendLog(logs, 'SSH 连接超时')
        finish({
          ok: false,
          status: 'failed',
          message: '连接超时，请检查服务器地址、端口或防火墙',
          stdout: '',
          stderr: '',
          exitCode: null,
          signal: null,
        })
      })

    client.connect(connectionConfig)
  })
}

/**
 * 读取远程主机的基础信息，连接测试成功后展示在状态面板。
 */
async function collectRemoteInfo(client) {
  const username = await execText(client, 'whoami')
  const hostname = await execText(client, 'hostname')
  const system = await execText(client, 'uname -srmo 2>/dev/null || uname -a')
  const workdir = await execText(client, 'pwd')
  const javaVersion = await execText(client, 'java -version 2>&1 | head -n 1 || true')

  return {
    username,
    hostname,
    system,
    workdir,
    javaVersion: javaVersion || '未检测到 Java',
  }
}

/**
 * 执行一条远程命令并返回文本结果。
 * stdout 为空时会回退读取 stderr，适合 java -version 这类输出到 stderr 的命令。
 */
function execText(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error)
        return
      }

      let stdout = ''
      let stderr = ''

      stream
        .on('close', () => {
          resolve((stdout || stderr).trim())
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

/**
 * 根据 exitCode 或 signal 生成用户可读的命令失败原因。
 */
function buildCommandFailureMessage(exitCode, signal) {
  if (signal) {
    return `命令执行被中断（signal: ${signal}）`
  }

  if (Number.isInteger(exitCode)) {
    return `命令执行失败（exit code: ${exitCode})`
  }

  return '命令执行失败'
}

/**
 * 裁剪过长输出，保护 UI 渲染和 IPC 传输。
 */
function trimOutput(output) {
  if (!output) {
    return ''
  }

  if (output.length <= MAX_OUTPUT_CHARS) {
    return output
  }

  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated]`
}

/**
 * 把多行命令压成一行摘要，用于日志标题。
 */
function summarizeCommand(command) {
  return command.replace(/\s+/g, ' ').slice(0, 80)
}

/**
 * 给日志追加统一时间前缀。
 */
function appendLog(logs, message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logs.push(`[${time}] ${message}`)
}

/**
 * 支持用户输入 ~/xxx 形式的私钥路径。
 */
function expandHome(filePath) {
  if (filePath === '~') {
    return os.homedir()
  }

  if (filePath.startsWith(`~${path.sep}`) || filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2))
  }

  return filePath
}

/**
 * 把 ssh2/网络层错误转换成更适合界面展示的中文提示。
 */
function sanitizeSshError(error) {
  const message = sanitizeError(error)

  if (message.includes('All configured authentication methods failed')) {
    return '认证失败，请检查用户名、密码或私钥'
  }

  if (message.includes('ENOTFOUND')) {
    return '无法解析服务器地址，请检查 Host'
  }

  if (message.includes('ECONNREFUSED')) {
    return '服务器拒绝连接，请检查端口、防火墙或 SSH 服务'
  }

  if (message.includes('ETIMEDOUT')) {
    return '连接超时，请检查网络、端口或安全组'
  }

  return message
}

/**
 * 统一提取 Error 对象的 message。
 */
function sanitizeError(error) {
  if (!error) {
    return '未知错误'
  }

  return String(error.message || error)
}
