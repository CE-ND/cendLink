import electron from 'electron'
import { randomUUID } from 'node:crypto'
import ssh2 from 'ssh2'
import {
  executeSshCommand,
  normalizeConnectionInput,
  testSshConnection,
  toSshConfig,
} from '../services/ssh/sshClient.js'

const { dialog } = electron
const { Client } = ssh2
const streamSessions = new Map()
// 持久交互式终端会话。与一次性命令流不同，这里保持 client.shell() 打开的伪终端，
// 支持键盘输入、窗口尺寸变化，直到用户主动关闭或页面卸载。
const shellSessions = new Map()

// 终端窗口行列的合法范围，避免异常尺寸传给远端 pty。
const MIN_TERMINAL_DIMENSION = 1
const MAX_TERMINAL_DIMENSION = 1000
const DEFAULT_TERMINAL_COLS = 80
const DEFAULT_TERMINAL_ROWS = 24

/**
 * 注册 SSH 相关 IPC 通道。
 * 渲染进程不直接引入 ssh2，也不直接读本地文件，只通过这些通道请求主进程处理。
 */
export function registerSshHandlers(ipcMain) {
  // 测试服务器连接，并读取 whoami/hostname/uname/pwd/java 等远程环境信息。
  ipcMain.handle('ssh:test-connection', async (_event, config) => {
    return testSshConnection(config)
  })

  // 基于当前 SSH 配置执行一条远程命令，返回 stdout/stderr/exitCode。
  ipcMain.handle('ssh:execute-command', async (_event, payload) => {
    return executeSshCommand(payload?.config, payload?.command)
  })

  // 启动一个持续输出的远程命令，用于 docker logs -f 等可停止场景。
  ipcMain.handle('ssh:start-command-stream', async (event, payload) => {
    try {
      const normalized = await normalizeConnectionInput(payload?.config)
      const command = normalizeStreamCommand(payload?.command)
      const sshConfig = await toSshConfig(normalized)
      const id = randomUUID()
      const webContents = event.sender
      const session = {
        id,
        client: new Client(),
        command,
        stream: null,
        settled: false,
        webContents,
      }

      streamSessions.set(id, session)
      webContents.once('destroyed', () => {
        stopCommandStream(session, '页面已关闭，停止日志跟随')
      })
      setImmediate(() => startCommandStream(session, sshConfig))

      return {
        ok: true,
        id,
        command,
      }
    } catch (error) {
      return {
        ok: false,
        message: error?.message || String(error),
      }
    }
  })

  // 停止持续输出的远程命令。
  ipcMain.handle('ssh:stop-command-stream', async (_event, id) => {
    const session = streamSessions.get(String(id || ''))

    if (!session) {
      return {
        ok: false,
        message: '未找到正在跟随的日志会话',
      }
    }

    stopCommandStream(session, '用户已停止跟随日志')

    return {
      ok: true,
    }
  })

  // 打开一个持久交互式终端（伪终端），返回会话 id，后续的输入/输出/尺寸都以该 id 关联。
  ipcMain.handle('ssh:open-shell', async (event, payload) => {
    try {
      const normalized = await normalizeConnectionInput(payload?.config)
      const sshConfig = await toSshConfig(normalized)
      const id = randomUUID()
      const webContents = event.sender
      const session = {
        id,
        client: new Client(),
        stream: null,
        settled: false,
        webContents,
      }

      const size = {
        cols: clampTerminalDimension(payload?.cols, DEFAULT_TERMINAL_COLS),
        rows: clampTerminalDimension(payload?.rows, DEFAULT_TERMINAL_ROWS),
      }

      shellSessions.set(id, session)
      webContents.once('destroyed', () => {
        closeShellSession(session, '页面已关闭，终端已断开')
      })
      setImmediate(() => openShellSession(session, sshConfig, size))

      return {
        ok: true,
        id,
      }
    } catch (error) {
      return {
        ok: false,
        message: error?.message || String(error),
      }
    }
  })

  // 接收终端键盘输入并写入远端 pty。高频调用，走 send 单向通道，不做应答。
  ipcMain.on('ssh:shell-input', (event, payload) => {
    const session = shellSessions.get(String(payload?.id || ''))

    if (!session?.stream || session.settled || session.webContents !== event.sender) {
      return
    }

    try {
      session.stream.write(String(payload?.data ?? ''))
    } catch {
      // 写入失败通常意味着 channel 已关闭，交由 close 事件收尾。
    }
  })

  // 终端容器尺寸变化时同步远端窗口大小，保证换行和光标定位正确。
  ipcMain.on('ssh:shell-resize', (event, payload) => {
    const session = shellSessions.get(String(payload?.id || ''))

    if (!session?.stream || session.settled || session.webContents !== event.sender) {
      return
    }

    const cols = clampTerminalDimension(payload?.cols, DEFAULT_TERMINAL_COLS)
    const rows = clampTerminalDimension(payload?.rows, DEFAULT_TERMINAL_ROWS)

    try {
      session.stream.setWindow(rows, cols, 0, 0)
    } catch {
      // 个别 SSH 服务端不支持窗口调整，忽略即可。
    }
  })

  // 关闭终端会话，释放 SSH 连接。
  ipcMain.on('ssh:close-shell', (event, id) => {
    const session = shellSessions.get(String(id || ''))

    if (session && session.webContents === event.sender) {
      closeShellSession(session, '终端已关闭')
    }
  })

  // 打开系统文件选择器，只返回 PEM/私钥路径，不读取也不保存私钥内容。
  ipcMain.handle('ssh:select-private-key-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 PEM 或 SSH 私钥文件',
      properties: ['openFile'],
      filters: [
        { name: 'PEM / SSH Private Key', extensions: ['pem', 'key'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    return {
      canceled: result.canceled,
      filePath: result.filePaths[0] || '',
    }
  })
}

function startCommandStream(session, sshConfig) {
  if (session.settled) {
    return
  }

  emitStreamEvent(session, {
    type: 'connecting',
    message: '正在建立 SSH 流式连接',
  })

  session.client
    .on('ready', () => {
      if (session.settled) {
        return
      }

      emitStreamEvent(session, {
        type: 'started',
        message: 'SSH 连接成功，开始跟随日志',
      })

      session.client.exec(session.command, (error, stream) => {
        if (session.settled) {
          return
        }

        if (error) {
          finishCommandStream(session, {
            type: 'error',
            message: `命令启动失败: ${error?.message || error}`,
          })
          return
        }

        session.stream = stream

        stream
          .on('data', (data) => {
            emitStreamEvent(session, {
              type: 'stdout',
              chunk: data.toString(),
            })
          })
          .on('close', (code, signal) => {
            finishCommandStream(session, {
              type: 'close',
              code: Number.isInteger(code) ? code : null,
              signal: signal || null,
              message: signal ? `日志跟随已结束，信号 ${signal}` : '日志跟随已结束',
            })
          })

        stream.stderr.on('data', (data) => {
          emitStreamEvent(session, {
            type: 'stderr',
            chunk: data.toString(),
          })
        })
      })
    })
    .on('error', (error) => {
      finishCommandStream(session, {
        type: 'error',
        message: error?.message || String(error),
      })
    })
    .on('timeout', () => {
      finishCommandStream(session, {
        type: 'error',
        message: 'SSH 流式连接超时',
      })
    })
    .connect(sshConfig)
}

function stopCommandStream(session, message = '日志跟随已停止') {
  if (session.stream) {
    try {
      session.stream.signal?.('KILL')
    } catch {
      // 部分 SSH 服务端不支持 signal，继续关闭 channel 和连接。
    }

    try {
      session.stream.close?.()
    } catch {
      // 关闭失败时由 client.end() 兜底。
    }
  }

  finishCommandStream(session, {
    type: 'stopped',
    message,
  })
}

function finishCommandStream(session, payload) {
  if (session.settled) {
    return
  }

  session.settled = true
  emitStreamEvent(session, payload)
  streamSessions.delete(session.id)
  session.client.end()
}

function emitStreamEvent(session, payload) {
  if (session.webContents.isDestroyed()) {
    return
  }

  session.webContents.send('ssh:command-stream-event', {
    id: session.id,
    command: session.command,
    ...payload,
  })
}

function normalizeStreamCommand(command) {
  const normalized = String(command || '').trim()

  if (!normalized) {
    throw new Error('请输入要执行的 Linux 命令')
  }

  return normalized
}

/**
 * 建立 SSH 连接并打开一个持久伪终端。
 * 与命令流不同，这里不指定单条命令，而是启动交互式 shell，
 * 输出通过 shell-event 持续推送，输入由 ssh:shell-input 写入。
 */
function openShellSession(session, sshConfig, size) {
  if (session.settled) {
    return
  }

  emitShellEvent(session, {
    type: 'connecting',
    message: '正在建立 SSH 终端连接',
  })

  session.client
    .on('ready', () => {
      if (session.settled) {
        return
      }

      session.client.shell(
        {
          term: 'xterm-256color',
          cols: size.cols,
          rows: size.rows,
        },
        (error, stream) => {
          if (session.settled) {
            // 会话已在握手后被关闭，直接结束 channel。
            try {
              stream?.close?.()
            } catch {
              // 忽略关闭异常。
            }
            return
          }

          if (error) {
            finishShellSession(session, {
              type: 'error',
              message: `终端启动失败: ${error?.message || error}`,
            })
            return
          }

          session.stream = stream

          emitShellEvent(session, {
            type: 'ready',
            message: '终端已就绪',
          })

          stream
            .on('data', (data) => {
              emitShellEvent(session, {
                type: 'data',
                chunk: data.toString('utf8'),
              })
            })
            .on('close', (code, signal) => {
              finishShellSession(session, {
                type: 'exit',
                code: Number.isInteger(code) ? code : null,
                signal: signal || null,
                message: signal ? `终端会话结束，信号 ${signal}` : '终端会话已结束',
              })
            })

          stream.stderr?.on('data', (data) => {
            emitShellEvent(session, {
              type: 'data',
              chunk: data.toString('utf8'),
            })
          })
        },
      )
    })
    .on('error', (error) => {
      finishShellSession(session, {
        type: 'error',
        message: sanitizeShellError(error),
      })
    })
    .on('timeout', () => {
      finishShellSession(session, {
        type: 'error',
        message: 'SSH 终端连接超时，请检查网络或服务器',
      })
    })
    .connect(sshConfig)
}

/**
 * 主动关闭终端会话：先尝试优雅结束 channel，再统一收尾。
 */
function closeShellSession(session, message = '终端已关闭') {
  if (session.stream) {
    try {
      session.stream.end?.()
    } catch {
      // 结束失败时由 client.end() 兜底。
    }

    try {
      session.stream.close?.()
    } catch {
      // 关闭失败时由 client.end() 兜底。
    }
  }

  finishShellSession(session, {
    type: 'closed',
    message,
  })
}

/**
 * 终端会话统一收尾：推送最终事件、移除登记并断开 SSH 连接。幂等。
 */
function finishShellSession(session, payload) {
  if (session.settled) {
    return
  }

  session.settled = true
  emitShellEvent(session, payload)
  shellSessions.delete(session.id)

  try {
    session.client.end()
  } catch {
    // 连接可能已断开，忽略。
  }
}

function emitShellEvent(session, payload) {
  if (session.webContents.isDestroyed()) {
    return
  }

  session.webContents.send('ssh:shell-event', {
    id: session.id,
    ...payload,
  })
}

/**
 * 把终端行/列尺寸夹到合法范围，异常输入回退到默认值。
 */
function clampTerminalDimension(value, fallback) {
  const dimension = Number(value)

  if (!Number.isInteger(dimension) || dimension < MIN_TERMINAL_DIMENSION) {
    return fallback
  }

  return Math.min(dimension, MAX_TERMINAL_DIMENSION)
}

/**
 * 把常见 SSH 连接错误转成更友好的中文提示。
 */
function sanitizeShellError(error) {
  const message = String(error?.message || error || '终端连接失败')

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
