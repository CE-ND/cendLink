import electron from 'electron'

const { BrowserWindow } = electron

export function registerWindowHandlers(ipcMain) {
  ipcMain.handle('window:minimize', (event) => {
    getEventWindow(event)?.minimize()
  })

  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = getEventWindow(event)

    if (!window) {
      return false
    }

    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }

    window.maximize()
    return true
  })

  ipcMain.handle('window:close', (event) => {
    getEventWindow(event)?.close()
  })

  ipcMain.handle('window:is-maximized', (event) => {
    return Boolean(getEventWindow(event)?.isMaximized())
  })
}

export function bindWindowStateEvents(window) {
  const sendState = () => {
    sendWindowState(window)
  }

  window.on('maximize', sendState)
  window.on('unmaximize', sendState)
  window.on('restore', sendState)
  window.webContents.once('did-finish-load', sendState)
}

function getEventWindow(event) {
  return BrowserWindow.fromWebContents(event.sender)
}

function sendWindowState(window) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return
  }

  window.webContents.send('window:maximized-changed', window.isMaximized())
}
