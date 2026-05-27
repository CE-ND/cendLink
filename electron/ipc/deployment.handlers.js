import electron from 'electron'
import { previewDeployment, runDeployment } from '../services/deployment/deploymentRunner.js'

const { dialog } = electron

/**
 * 注册远程部署相关 IPC。
 * 负责 tar.gz 选择、部署计划预览和真实部署执行。
 */
export function registerDeploymentHandlers(ipcMain) {
  ipcMain.handle('deployment:select-package-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Docker 镜像包',
      properties: ['openFile'],
      filters: [
        { name: 'Docker Image Package', extensions: ['gz', 'tar'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    return {
      canceled: result.canceled,
      filePath: result.filePaths[0] || '',
    }
  })

  ipcMain.handle('deployment:preview', async (_event, config) => {
    return previewDeployment(config)
  })

  ipcMain.handle('deployment:run', async (_event, payload) => {
    return runDeployment(payload?.connection, payload?.config)
  })
}
