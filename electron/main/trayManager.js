import electron from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { app, BrowserWindow, Menu, Tray } = electron

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let tray = null
// 「关闭时最小化到托盘」开关。启动时从 app_settings 读一次，保存设置后由 IPC 同步。
let closeToTrayEnabled = false
// 托盘菜单点「退出」后置位，让 close 事件不再拦截，走真正的退出流程。
let isQuitting = false

function getTrayIconPath() {
  return path.join(__dirname, '..', '..', 'build', 'icon.ico')
}

/**
 * 启动时初始化开关；开启时立即创建托盘图标，保证隐藏后总能从托盘找回窗口。
 */
function initCloseToTray(enabled) {
  setCloseToTrayEnabled(enabled)
}

/**
 * 更新「关闭时最小化到托盘」开关，并同步托盘图标的创建与销毁。
 */
function setCloseToTrayEnabled(enabled) {
  closeToTrayEnabled = Boolean(enabled)

  if (closeToTrayEnabled) {
    ensureTray()
    return
  }

  destroyTray()
}

/**
 * 窗口 close 事件里判断：本次关闭是否应该转成隐藏到托盘。
 */
function shouldHideToTray() {
  return closeToTrayEnabled && !isQuitting
}

/**
 * 托盘菜单点「退出」前调用，避免 app.quit() 触发的 close 再被拦截成隐藏。
 */
function markQuitting() {
  isQuitting = true
}

function ensureTray() {
  if (tray) {
    return
  }

  tray = new Tray(getTrayIconPath())
  tray.setToolTip('CendLink')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主界面', click: showMainWindow },
      { type: 'separator' },
      { label: '退出', click: quitFromTray },
    ]),
  )
  // Windows 左键单击托盘图标直接恢复窗口；macOS 设置菜单后 click 会优先弹菜单。
  tray.on('click', showMainWindow)
}

function destroyTray() {
  tray?.destroy()
  tray = null
}

function showMainWindow() {
  const window = BrowserWindow.getAllWindows()[0]

  if (!window) {
    return
  }

  if (window.isMinimized()) {
    window.restore()
  }

  window.show()
  window.focus()
}

function quitFromTray() {
  markQuitting()
  app.quit()
}

export { initCloseToTray, setCloseToTrayEnabled, shouldHideToTray, markQuitting }
