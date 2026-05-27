import electron from 'electron'
import { executeSshCommand, testSshConnection } from '../services/ssh/sshClient.js'

const { dialog } = electron

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
