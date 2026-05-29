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
