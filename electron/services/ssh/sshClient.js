import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ssh2 from 'ssh2'

const { Client } = ssh2

const DEFAULT_TIMEOUT_MS = 10000

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
    throw new Error('端口必须是 1 到 65535 之间的数字')
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

function appendLog(logs, message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logs.push(`[${time}] ${message}`)
}

function expandHome(filePath) {
  if (filePath === '~') {
    return os.homedir()
  }

  if (filePath.startsWith(`~${path.sep}`) || filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2))
  }

  return filePath
}

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

function sanitizeError(error) {
  if (!error) {
    return '未知错误'
  }

  return String(error.message || error)
}
