import { getDatabaseStorageInfo } from '../services/database/index.js'
import {
  deleteServer,
  getServer,
  listServers,
  saveServer,
} from '../services/database/repositories/serverRepository.js'
import {
  listCommandRuns,
  recordCommandRun,
} from '../services/database/repositories/commandRunRepository.js'
import {
  deleteDeployment,
  listDeployments,
  recordImagePackage,
  recordRemoteDeployment,
} from '../services/database/repositories/deploymentRepository.js'
import {
  deleteDockerfileTemplate,
  listDockerfileTemplates,
  saveDockerfileTemplate,
} from '../services/database/repositories/dockerfileTemplateRepository.js'
import { getSetting, setSetting } from '../services/database/repositories/settingsRepository.js'
import { decryptPassword, encryptPassword } from '../services/credential/passwordVault.js'

/**
 * 注册本地数据存储 IPC 通道。
 * 这里统一把数据库模型转换成渲染进程能安全使用的数据结构。
 */
export function registerStorageHandlers(ipcMain) {
  // 返回 ~/.cendLink 下的数据库、日志、临时目录路径。
  ipcMain.handle('data:get-storage-info', async () => {
    return getDatabaseStorageInfo()
  })

  // 读取服务器列表，返回前会移除加密密文字段。
  ipcMain.handle('servers:list', async () => {
    const servers = await listServers()
    return servers.map(toRendererServer)
  })

  // 保存服务器配置；如果用户勾选“记住密码”，会先加密密码再入库。
  ipcMain.handle('servers:save', async (_event, server) => {
    const payload = await prepareServerForStorage(server)
    const saved = await saveServer(payload)

    return toRendererServer(saved)
  })

  ipcMain.handle('servers:delete', async (_event, id) => {
    return deleteServer(id)
  })

  ipcMain.handle('history:list-command-runs', async (_event, limit) => {
    return listCommandRuns(limit)
  })

  ipcMain.handle('history:record-command-run', async (_event, commandRun) => {
    return recordCommandRun(commandRun)
  })

  ipcMain.handle('history:list-deployments', async (_event, limit) => {
    return listDeployments(limit)
  })

  ipcMain.handle('history:record-image-package', async (_event, imagePackage) => {
    return recordImagePackage(imagePackage)
  })

  ipcMain.handle('history:record-remote-deployment', async (_event, deployment) => {
    return recordRemoteDeployment(deployment)
  })

  ipcMain.handle('history:delete-deployment', async (_event, id) => {
    return deleteDeployment(id)
  })

  ipcMain.handle('dockerfile-templates:list', async () => {
    return listDockerfileTemplates()
  })

  ipcMain.handle('dockerfile-templates:save', async (_event, template) => {
    return saveDockerfileTemplate(template)
  })

  ipcMain.handle('dockerfile-templates:delete', async (_event, id) => {
    return deleteDockerfileTemplate(id)
  })

  ipcMain.handle('settings:get', async (_event, key, fallbackValue) => {
    return getSetting(key, fallbackValue)
  })

  ipcMain.handle('settings:set', async (_event, key, value) => {
    return setSetting(key, value)
  })
}

/**
 * 把渲染进程提交的服务器表单转换为数据库可保存结构。
 * 字段说明：
 * - password：用户本次输入的明文密码，只在 IPC 调用过程中短暂存在。
 * - rememberPassword：是否允许把密码加密后写入本地数据库。
 * - passwordSecret：safeStorage 加密后的密码密文，数据库只保存这个字段。
 */
async function prepareServerForStorage(server = {}) {
  const rememberPassword = Boolean(server.rememberPassword)
  const password = String(server.password || '')
  // 编辑已有服务器且密码输入框为空时，用于保留之前已经加密保存的密码。
  const existing = server.id ? await getServer(server.id) : null

  let passwordSecret = ''

  if (server.authType === 'password' && rememberPassword) {
    if (password) {
      passwordSecret = encryptPassword(password)
    } else if (existing?.passwordSecret) {
      passwordSecret = existing.passwordSecret
    } else {
      throw new Error('勾选记住密码时，请先填写密码')
    }
  }

  return {
    ...server,
    rememberPassword: server.authType === 'password' && rememberPassword,
    passwordSecret,
  }
}

/**
 * 转换数据库服务器记录给前端使用。
 * 数据库里的 passwordSecret 不会返回到渲染进程；只有用户明确选择记住密码时，
 * 才解密成 password 用于回填表单。
 */
function toRendererServer(server) {
  if (!server) {
    return null
  }

  const password =
    server.authType === 'password' && server.rememberPassword && server.passwordSecret
      ? decryptPassword(server.passwordSecret)
      : ''

  const { passwordSecret, ...safeServer } = server

  return {
    ...safeServer,
    password,
  }
}
