import electron from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildImagePackage, previewImagePackage } from '../services/docker/imagePackageBuilder.js'
import { imagePackagesDir } from '../services/database/paths.js'

const { dialog, shell } = electron

/**
 * 注册本地 Docker 镜像包构建相关 IPC。
 * 这部分只操作用户本机，不连接远程服务器。
 */
export function registerDockerHandlers(ipcMain) {
  // 选择本地 Jar 文件，渲染进程只拿到路径。
  ipcMain.handle('docker:select-jar-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Java Jar 包',
      properties: ['openFile'],
      filters: [
        { name: 'Java Jar', extensions: ['jar'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    return {
      canceled: result.canceled,
      filePath: result.filePaths[0] || '',
    }
  })

  // 生成 Dockerfile 和镜像名预览，便于用户在执行前确认配置。
  ipcMain.handle('docker:preview-image-package', async (_event, config) => {
    return previewImagePackage(config)
  })

  // 执行本地 docker build/save/gzip，生成 .tar.gz 镜像包。
  ipcMain.handle('docker:build-image-package', async (_event, config) => {
    return buildImagePackage(config)
  })

  // 打开镜像包输出目录；如果已知具体文件，则直接在文件管理器中定位该文件。
  ipcMain.handle('docker:open-image-package-directory', async (_event, packagePath = '') => {
    const targetPath = String(packagePath || '').trim()

    if (targetPath) {
      const stat = await fs.stat(targetPath).catch(() => null)

      if (stat?.isFile()) {
        shell.showItemInFolder(targetPath)
        return {
          ok: true,
          mode: 'reveal-file',
          openedPath: path.dirname(targetPath),
          packagePath: targetPath,
        }
      }

      if (stat?.isDirectory()) {
        const openError = await shell.openPath(targetPath)

        if (openError) {
          throw new Error(openError)
        }

        return {
          ok: true,
          mode: 'open-directory',
          openedPath: targetPath,
          packagePath: '',
        }
      }
    }

    const openError = await shell.openPath(imagePackagesDir)

    if (openError) {
      throw new Error(openError)
    }

    return {
      ok: true,
      mode: 'open-directory',
      openedPath: imagePackagesDir,
      packagePath: '',
    }
  })
}
