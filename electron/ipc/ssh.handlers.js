import { dialog } from 'electron'
import { testSshConnection } from '../services/ssh/sshClient.js'

export function registerSshHandlers(ipcMain) {
  ipcMain.handle('ssh:test-connection', async (_event, config) => {
    return testSshConnection(config)
  })

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
