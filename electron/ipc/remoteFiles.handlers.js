import electron from 'electron'
import path from 'node:path'
import {
  deleteRemoteFileAnnotations,
  listRemoteFileAnnotations,
  moveRemoteFileAnnotations,
  saveRemoteFileAnnotation,
} from '../services/database/repositories/remoteFileAnnotationRepository.js'
import {
  createRemoteDirectory,
  deleteRemotePaths,
  downloadRemoteFile,
  listRemoteDirectory,
  renameRemotePath,
  uploadRemoteFile,
} from '../services/files/remoteFileManager.js'

const { dialog } = electron

export function registerRemoteFileHandlers(ipcMain) {
  ipcMain.handle('remote-files:list', async (_event, payload) => {
    return runFileOperation(() => listRemoteDirectory(payload?.connection, payload?.path))
  })

  ipcMain.handle('remote-files:select-upload-files', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections'],
    })

    return {
      canceled: result.canceled,
      filePaths: result.filePaths || [],
    }
  })

  ipcMain.handle('remote-files:upload', async (_event, payload) => {
    return runFileOperation(() => uploadRemoteFile(payload?.connection, payload))
  })

  ipcMain.handle('remote-files:create-directory', async (_event, payload) => {
    return runFileOperation(() => createRemoteDirectory(payload?.connection, payload))
  })

  ipcMain.handle('remote-files:rename', async (_event, payload) => {
    const response = await runFileOperation(() => renameRemotePath(payload?.connection, payload))

    if (response.ok && payload?.serverKey) {
      response.annotationWarning = await runAnnotationMaintenance(() => (
        moveRemoteFileAnnotations(payload.serverKey, response.sourcePath, response.destinationPath)
      ))
    }

    return response
  })

  ipcMain.handle('remote-files:delete', async (_event, payload) => {
    const response = await runFileOperation(() => deleteRemotePaths(payload?.connection, payload))

    if (response.ok && payload?.serverKey) {
      response.annotationWarning = await runAnnotationMaintenance(() => (
        deleteRemoteFileAnnotations(payload.serverKey, response.deleted)
      ))
    }

    return response
  })

  ipcMain.handle('remote-files:download', async (_event, payload) => {
    const remotePath = String(payload?.remotePath || '').trim()
    const suggestedName = path.posix.basename(remotePath) || 'download'
    const result = await dialog.showSaveDialog({
      title: '保存远程文件',
      defaultPath: suggestedName,
    })

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true }
    }

    return runFileOperation(() => downloadRemoteFile(payload?.connection, {
      remotePath,
      localPath: result.filePath,
    }))
  })

  ipcMain.handle('remote-files:list-annotations', async (_event, payload) => {
    return runFileOperation(async () => ({
      ok: true,
      annotations: await listRemoteFileAnnotations(payload?.serverKey, payload?.paths),
    }))
  })

  ipcMain.handle('remote-files:save-annotation', async (_event, payload) => {
    return runFileOperation(async () => ({
      ok: true,
      item: await saveRemoteFileAnnotation(payload),
    }))
  })
}

async function runAnnotationMaintenance(operation) {
  try {
    await operation()
    return ''
  } catch (error) {
    return error?.message || String(error)
  }
}

async function runFileOperation(operation) {
  try {
    return await operation()
  } catch (error) {
    return {
      ok: false,
      status: error?.code === 'REMOTE_FILE_CONFLICT' ? 'conflict' : 'failed',
      code: String(error?.code || ''),
      message: error?.message || String(error),
      remotePath: error?.remotePath || '',
      fileName: error?.fileName || '',
    }
  }
}
