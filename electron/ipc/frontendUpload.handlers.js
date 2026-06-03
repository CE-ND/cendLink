import electron from 'electron'
import { previewFrontendUpload, runFrontendUpload } from '../services/frontend/frontendUploadRunner.js'

const { dialog } = electron

export function registerFrontendUploadHandlers(ipcMain) {
  ipcMain.handle('frontend-upload:select-archive-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择前端压缩包',
      properties: ['openFile'],
      filters: [
        { name: 'Frontend Package', extensions: ['zip', 'tar', 'gz', 'tgz'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    return {
      canceled: result.canceled,
      filePath: result.filePaths[0] || '',
    }
  })

  ipcMain.handle('frontend-upload:preview', async (_event, config) => {
    return previewFrontendUpload(config)
  })

  ipcMain.handle('frontend-upload:run', async (_event, payload) => {
    return runFrontendUpload(payload?.connection, payload?.config)
  })
}
