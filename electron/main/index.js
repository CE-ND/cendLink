import { app, BrowserWindow, Menu, ipcMain, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerSshHandlers } from '../ipc/ssh.handlers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow

function createWindow() {
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
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.setMenuBarVisibility(false)

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'))
    return
  }

  mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:4001')
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerSshHandlers(ipcMain)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
