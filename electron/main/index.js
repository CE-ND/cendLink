import electron from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerDeploymentHandlers } from '../ipc/deployment.handlers.js'
import { registerDockerHandlers } from '../ipc/docker.handlers.js'
import { registerFrontendUploadHandlers } from '../ipc/frontendUpload.handlers.js'
import { registerRemoteFileHandlers } from '../ipc/remoteFiles.handlers.js'
import { registerSshHandlers } from '../ipc/ssh.handlers.js'
import { registerStorageHandlers } from '../ipc/storage.handlers.js'
import { bindWindowStateEvents, registerWindowHandlers } from '../ipc/window.handlers.js'
import { initCloseToTray, shouldHideToTray } from './trayManager.js'
import { initializeDatabase } from '../services/database/index.js'
import { getSetting } from '../services/database/repositories/settingsRepository.js'

const { app, BrowserWindow, Menu, ipcMain, screen } = electron
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 主窗口实例。保留到模块作用域，避免窗口被 GC 回收。
let mainWindow

/**
 * 创建 Electron 桌面窗口，并按运行环境加载页面。
 * - 开发环境：加载 Vite dev server。
 * - 打包环境：加载 dist/index.html。
 */
function createWindow() {
  // 读取主屏幕尺寸，让应用启动后直接铺满当前屏幕可用区域。
  const primaryDisplay = screen.getPrimaryDisplay()
  const { x, y, width, height } = primaryDisplay.bounds

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    autoHideMenuBar: true,
    minWidth: 980,
    minHeight: 620,
    title: 'CendLink',
    frame: false,
    backgroundColor: '#f3f5f8',
    webPreferences: {
      // preload 是渲染进程和主进程通信的安全桥，只暴露白名单 API。
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: getAppIconPath(),
  })
  mainWindow.setMenuBarVisibility(false)
  bindWindowStateEvents(mainWindow)

  // 开启「关闭时最小化到托盘」后，关闭只隐藏窗口，由托盘菜单恢复或退出。
  mainWindow.on('close', (event) => {
    if (!shouldHideToTray()) {
      return
    }

    event.preventDefault()
    mainWindow.hide()
  })

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'))
    return
  }

  mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:4001')
}

function getAppIconPath() {
  return path.join(__dirname, '..', '..', 'build', 'icon.ico')
}

app.whenReady().then(async () => {
  // 初始化顺序：先准备本地数据库，再注册 IPC，最后创建窗口。
  Menu.setApplicationMenu(null)
  await initializeDatabase()
  // 关闭行为设置持久化在 app_settings，启动时读一次决定托盘图标是否常驻。
  initCloseToTray(Boolean(await getSetting('minimizeToTray', false)))
  registerDeploymentHandlers(ipcMain)
  registerDockerHandlers(ipcMain)
  registerFrontendUploadHandlers(ipcMain)
  registerRemoteFileHandlers(ipcMain)
  registerSshHandlers(ipcMain)
  registerStorageHandlers(ipcMain)
  registerWindowHandlers(ipcMain)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // macOS 通常保留应用进程，Windows/Linux 关闭最后一个窗口后直接退出。
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
