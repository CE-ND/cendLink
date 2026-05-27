import { computed, reactive, ref } from 'vue'

// 渲染进程共享会话状态。各个页面通过它复用 SSH 上下文，避免切页后状态丢失。
const form = reactive({
  // 服务器显示名，保存到本地列表和历史记录中。
  name: '默认服务器',
  // SSH 服务器地址，可以是 IP 或域名。
  host: '',
  // SSH 端口，默认 22。
  port: 22,
  // SSH 登录用户名。
  username: 'root',
  // 登录方式：password 表示密码；privateKey 表示 PEM/SSH 私钥文件。
  authType: 'password',
  // 密码登录使用的明文密码；未勾选记住密码时不会写入数据库。
  password: '',
  // 是否允许把 password 用 safeStorage 加密后保存。
  rememberPassword: false,
  // PEM/SSH 私钥文件路径；只保存路径，不保存私钥内容。
  privateKeyPath: '',
  // 私钥口令，当前只用于本次连接，不做持久化。
  passphrase: '',
  // SSH 连接超时时间，单位毫秒。
  timeoutMs: 10000,
})

// 最近一次连接测试结果。
const result = ref(null)
// 最近一次远程命令执行结果。
const commandResult = ref(null)
// 命令输入框内容。
const commandText = ref('')
// Jar 打镜像包页的表单对象。
const packageForm = reactive({
  jarPath: '',
  serviceName: 'demo-service',
  serviceVersion: '1.0.0',
  servicePort: 8080,
  javaVersion: '17',
  javaOpts: '-Xms512m -Xmx1024m -XX:+UseG1GC -XX:MaxGCPauseMillis=200',
  baseImage: 'eclipse-temurin:17-jre-alpine',
  useNonRootUser: true,
  appUser: 'spring',
})
// 镜像包预览配置。
const packagePreview = ref(null)
// 镜像包构建结果。
const packageResult = ref(null)
// 镜像包构建中状态。
const isBuildingPackage = ref(false)
// 连接测试进行中状态。
const isTesting = ref(false)
// 远程命令执行中状态。
const isExecutingCommand = ref(false)
// 本地数据库初始化/读取中状态。
const isLoadingStoredData = ref(false)
// 保存服务器配置进行中状态。
const isSavingServer = ref(false)
// 本地数据库中已保存的服务器列表。
const savedServers = ref([])
// 本地数据库中最近的命令执行记录。
const commandRuns = ref([])
// 本地数据库中最近的部署/镜像包记录。
const deployments = ref([])
// 当前选中的已保存服务器 id；空字符串代表尚未保存或未选中。
const activeServerId = ref('')
// ~/.cendLink 存储目录信息。
const storageInfo = ref(null)
// 最近一次成功发起连接测试时的表单快照，用于判断配置是否已变更。
const lastTestedSnapshot = ref('')
// 避免多页面重复读取数据库。
const hasLoadedStoredData = ref(false)
// 底部 Activity Log 展示的日志行。
const logs = ref([
  logLine('连接模块已就绪'),
  logLine('通过 Electron 启动后，可以执行真实 SSH 连接测试和远程命令'),
])

const hasElectronBridge = computed(() => {
  const bridge = getStorageBridge()
  const ssh = bridge?.ssh
  const docker = bridge?.docker

  return Boolean(
    ssh?.testConnection &&
      ssh?.executeCommand &&
      ssh?.selectPrivateKeyFile &&
      docker?.selectJarFile &&
      docker?.buildImagePackage,
  )
})

const hasStorageBridge = computed(() => {
  const bridge = getStorageBridge()

  return Boolean(
    bridge?.servers?.list &&
      bridge?.servers?.save &&
      bridge?.history?.listDeployments &&
      bridge?.history?.recordCommandRun &&
      bridge?.history?.recordImagePackage,
  )
})

// 当前连接配置的序列化快照。任何影响 SSH 连接的字段变化都会改变该值。
const currentConnectionSnapshot = computed(() => {
  return JSON.stringify({
    host: form.host.trim(),
    port: Number(form.port || 22),
    username: form.username.trim(),
    authType: form.authType,
    password: form.password,
    rememberPassword: form.rememberPassword,
    privateKeyPath: form.privateKeyPath.trim(),
    passphrase: form.passphrase,
    timeoutMs: Number(form.timeoutMs || 10000),
  })
})

// 判断当前表单是否已经不同于最近一次测试使用的配置。
const needsRetest = computed(() => {
  return Boolean(lastTestedSnapshot.value) && lastTestedSnapshot.value !== currentConnectionSnapshot.value
})

// 命令执行前置条件：Electron 桥接可用、连接测试成功、配置未变更、当前没有任务运行。
const canExecuteCommand = computed(() => {
  return Boolean(
    hasElectronBridge.value &&
      result.value?.ok &&
      !needsRetest.value &&
      !isTesting.value &&
      !isExecutingCommand.value,
  )
})

// 当前 Jar 打包配置是否完整。
const canBuildImagePackage = computed(() => {
  return Boolean(
    hasElectronBridge.value &&
      packageForm.jarPath &&
      packageForm.serviceName.trim() &&
      packageForm.serviceVersion.trim() &&
      Number.isInteger(Number(packageForm.servicePort || 0)) &&
      Number(packageForm.servicePort || 0) > 0,
  )
})

// 命令输入区下方的状态提示文本。
const commandHint = computed(() => {
  if (!hasElectronBridge.value) {
    return '请通过 Electron 模式启动应用后再执行远程命令。'
  }

  if (isTesting.value) {
    return '连接测试进行中，请等待测试结果。'
  }

  if (!result.value?.ok) {
    return '请先测试连接，连接成功后再执行命令。'
  }

  if (needsRetest.value) {
    return '服务器连接信息已变更，请重新测试连接。'
  }

  if (isExecutingCommand.value) {
    return '命令执行中，请等待服务器返回结果。'
  }

  return '支持一次性 Linux 命令，例如 pwd、ls -la /opt/app、systemctl status my-service。'
})

// 镜像打包页的预览提示。
const packageHint = computed(() => {
  if (!hasElectronBridge.value) {
    return '请通过 Electron 模式启动应用后再生成镜像包。'
  }

  if (!packageForm.jarPath) {
    return '先选择一个 Jar 包，再预览 Dockerfile 和镜像包信息。'
  }

  if (!packageForm.serviceName.trim()) {
    return '请填写服务名，用于生成镜像名。'
  }

  if (!packageForm.serviceVersion.trim()) {
    return '请填写服务版本，用于生成镜像 tag。'
  }

  return '点击“生成镜像包”后，会在本地生成 Dockerfile、docker build、docker save，并压缩成 tar.gz。'
})

/**
 * 合并更新服务器表单。
 * 如果连接参数发生变化，会清空最近一次命令结果，避免旧结果误导用户。
 */
function updateForm(nextValue) {
  const previousSnapshot = currentConnectionSnapshot.value

  Object.assign(form, nextValue)

  if (previousSnapshot !== currentConnectionSnapshot.value) {
    commandResult.value = null
  }
}

/**
 * 更新命令输入框文本。
 */
function updateCommandText(value) {
  commandText.value = value
}

/**
 * 更新镜像包表单。
 */
function updatePackageForm(nextValue) {
  Object.assign(packageForm, nextValue)
  packagePreview.value = null
  packageResult.value = null
  void refreshPackagePreview()
}

/**
 * 从 Electron 主进程读取本地存储信息、服务器列表和命令历史。
 * 该函数由 AppShell 挂载时调用一次。
 */
async function loadStoredData() {
  if (hasLoadedStoredData.value || isLoadingStoredData.value) {
    return
  }

  const bridge = getStorageBridge()

  if (!hasStorageBridge.value) {
    hasLoadedStoredData.value = true
    return
  }

  isLoadingStoredData.value = true

  try {
    const [info, servers, runs, deploymentRows] = await Promise.all([
      bridge.data.getStorageInfo(),
      bridge.servers.list(),
      bridge.history.listCommandRuns(50),
      bridge.history.listDeployments(50),
    ])

    storageInfo.value = info
    savedServers.value = servers
    commandRuns.value = runs
    deployments.value = deploymentRows
    hasLoadedStoredData.value = true
    logs.value.push(logLine(`本地数据目录已就绪: ${info.dataDir}`))
  } catch (error) {
    logs.value.push(logLine(`读取本地数据失败: ${error?.message || error}`))
  } finally {
    isLoadingStoredData.value = false
  }
}

/**
 * 选择本地 Jar 文件。
 */
async function selectJarFile() {
  const docker = getDockerBridge()

  if (!docker?.selectJarFile) {
    logs.value.push(logLine('当前是浏览器预览模式，无法打开 Jar 文件选择器'))
    return
  }

  const selected = await docker.selectJarFile()

  if (selected?.canceled || !selected?.filePath) {
    logs.value.push(logLine('已取消选择 Jar 文件'))
    return
  }

  updatePackageForm({ jarPath: selected.filePath })
  logs.value.push(logLine(`已选择 Jar 文件: ${selected.filePath}`))
  await refreshPackagePreview()
}

/**
 * 读取主进程生成的 Dockerfile 预览和镜像名信息。
 */
async function refreshPackagePreview() {
  const docker = getDockerBridge()

  if (!docker?.previewImagePackage) {
    return
  }

  try {
    packagePreview.value = await docker.previewImagePackage({ ...packageForm })
  } catch (error) {
    packagePreview.value = null
    logs.value.push(logLine(`读取镜像配置预览失败: ${error?.message || error}`))
  }
}

/**
 * 在本地生成 Docker 镜像压缩包。
 */
async function buildImagePackage() {
  if (!canBuildImagePackage.value) {
    return
  }

  const docker = getDockerBridge()

  if (!docker?.buildImagePackage) {
    packageResult.value = {
      ok: false,
      status: 'failed',
      message: '当前是浏览器预览模式，无法生成镜像包',
      durationMs: 0,
    }
    return
  }

  isBuildingPackage.value = true

  try {
    const response = await docker.buildImagePackage({ ...packageForm })
    packageResult.value = response
    packagePreview.value = {
      ...response,
      jarName: response.jarName,
    }
    logs.value = response.logs?.length ? response.logs : [logLine(response.message)]
    const savedDeployment = await recordImagePackage(response)
    if (savedDeployment) {
      upsertDeployment(savedDeployment)
    }
  } catch (error) {
    packageResult.value = {
      ok: false,
      status: 'failed',
      message: error?.message || '镜像包生成失败',
      durationMs: 0,
    }
    logs.value.push(logLine(packageResult.value.message))
  } finally {
    isBuildingPackage.value = false
  }
}

/**
 * 保存当前服务器配置到 SQLite。
 * 密码是否保存由 form.rememberPassword 决定，真正加密逻辑在主进程处理。
 */
async function saveCurrentServer() {
  const bridge = getStorageBridge()

  if (!bridge?.servers?.save) {
    logs.value.push(logLine('当前是浏览器预览模式，无法保存服务器配置'))
    return
  }

  isSavingServer.value = true

  try {
    const saved = await bridge.servers.save(toServerPayload())

    activeServerId.value = saved.id
    upsertSavedServer(saved)
    logs.value.push(logLine(`服务器配置已保存: ${saved.name}`))
  } catch (error) {
    logs.value.push(logLine(`保存服务器失败: ${error?.message || error}`))
  } finally {
    isSavingServer.value = false
  }
}

/**
 * 从侧边栏选择一个已保存服务器，并把配置回填到表单。
 * passphrase 不回填，避免把私钥口令持久化。
 */
function selectSavedServer(serverId) {
  const server = savedServers.value.find((item) => item.id === serverId)

  if (!server) {
    return
  }

  activeServerId.value = server.id
  updateForm({
    ...form,
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    authType: server.authType,
    password: server.password || '',
    rememberPassword: server.rememberPassword,
    privateKeyPath: server.privateKeyPath || '',
    passphrase: '',
    timeoutMs: server.timeoutMs,
  })

  result.value = null
  commandResult.value = null
  lastTestedSnapshot.value = ''
  logs.value.push(logLine(`已载入服务器配置: ${server.name}`))
}

/**
 * 发起 SSH 连接测试，并把连接结果、远程环境信息和服务器状态写回本地数据。
 */
async function testConnection() {
  if (isTesting.value) {
    return
  }

  const ssh = getSshBridge()

  result.value = null
  commandResult.value = null
  lastTestedSnapshot.value = ''
  isTesting.value = true
  logs.value = [logLine(`开始测试 ${form.username}@${form.host || '未填写 Host'}:${form.port}`)]

  if (!ssh?.testConnection) {
    result.value = {
      ok: false,
      status: 'failed',
      message: '当前是浏览器预览模式，无法调用 Electron SSH 能力',
      durationMs: 0,
    }
    logs.value.push(logLine('请先运行 npm run dev:electron'))
    isTesting.value = false
    return
  }

  try {
    const response = await ssh.testConnection({ ...form })

    result.value = response
    commandResult.value = null
    lastTestedSnapshot.value = currentConnectionSnapshot.value
    logs.value = response.logs?.length ? response.logs : [logLine(response.message)]
    await persistActiveServerStatus(response)
  } catch (error) {
    result.value = {
      ok: false,
      status: 'failed',
      message: error?.message || '连接测试失败',
      durationMs: 0,
    }
    lastTestedSnapshot.value = currentConnectionSnapshot.value
    logs.value.push(logLine(result.value.message))
    await persistActiveServerStatus(result.value)
  } finally {
    isTesting.value = false
  }
}

/**
 * 使用当前连接配置执行命令输入框中的远程 Linux 命令。
 * 执行结束后会追加日志，并写入 command_runs 表。
 */
async function executeCommand() {
  if (!canExecuteCommand.value) {
    return
  }

  const ssh = getSshBridge()
  const command = commandText.value.trim()

  if (!command) {
    commandResult.value = {
      ok: false,
      status: 'failed',
      message: '请输入要执行的 Linux 命令',
      exitCode: null,
      durationMs: 0,
    }
    return
  }

  if (!ssh?.executeCommand) {
    commandResult.value = {
      ok: false,
      status: 'failed',
      command,
      message: '当前是浏览器预览模式，无法调用 Electron SSH 能力',
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: 0,
    }
    return
  }

  isExecutingCommand.value = true

  try {
    const response = await ssh.executeCommand({ ...form }, command)

    commandResult.value = response
    appendCommandOutput(response)
    await recordCommandRun(response)
  } catch (error) {
    const failure = {
      ok: false,
      status: 'failed',
      command,
      message: error?.message || '命令执行失败',
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: 0,
    }

    commandResult.value = failure
    appendCommandOutput(failure)
    await recordCommandRun(failure)
  } finally {
    isExecutingCommand.value = false
  }
}

/**
 * 调用主进程打开 PEM/私钥文件选择器，并把选中的路径写入表单。
 */
async function selectPrivateKeyFile() {
  const ssh = getSshBridge()

  if (!ssh?.selectPrivateKeyFile) {
    logs.value.push(logLine('当前是浏览器预览模式，无法打开本地文件选择器'))
    return
  }

  const selected = await ssh.selectPrivateKeyFile()

  if (selected?.canceled || !selected?.filePath) {
    logs.value.push(logLine('已取消选择 PEM / 私钥文件'))
    return
  }

  updateForm({
    ...form,
    authType: 'privateKey',
    privateKeyPath: selected.filePath,
  })
  logs.value.push(logLine('已导入 PEM / 私钥文件路径'))
}

/**
 * 清空 Activity Log。
 */
function clearLogs() {
  logs.value = []
}

/**
 * 把命令执行结果格式化追加到底部日志面板。
 */
function appendCommandOutput(response) {
  const nextLines = [...logs.value]
  const command = response.command || commandText.value.trim()

  if (nextLines.length) {
    nextLines.push('')
  }

  nextLines.push(logLine(`命令执行结束: ${summarizeCommand(command)}`))
  nextLines.push(...formatCommandLines(command))

  if (response.stdout) {
    nextLines.push(...toDisplayLines(response.stdout))
  }

  if (response.stderr) {
    if (response.stdout) {
      nextLines.push('')
    }

    nextLines.push('[stderr]')
    nextLines.push(...toDisplayLines(response.stderr))
  }

  if (!response.stdout && !response.stderr) {
    nextLines.push('[no output]')
  }

  nextLines.push(
    `[exit code] ${response.exitCode ?? '-'} | [duration] ${response.durationMs ?? 0} ms`,
  )

  logs.value = nextLines
}

/**
 * 连接测试完成后，把当前服务器的最近状态保存到 SQLite。
 */
async function persistActiveServerStatus(response) {
  const bridge = getStorageBridge()

  if (!activeServerId.value || !bridge?.servers?.save) {
    return
  }

  try {
    const saved = await bridge.servers.save(
      toServerPayload({
        lastStatus: response.ok ? 'connected' : 'failed',
        lastMessage: response.message || '',
        lastConnectedAt: response.ok ? new Date().toISOString() : null,
      }),
    )

    upsertSavedServer(saved)
  } catch (error) {
    logs.value.push(logLine(`更新服务器状态失败: ${error?.message || error}`))
  }
}

/**
 * 把一次命令执行结果保存为历史记录。
 */
async function recordCommandRun(response) {
  const bridge = getStorageBridge()

  if (!bridge?.history?.recordCommandRun) {
    return
  }

  try {
    const savedRun = await bridge.history.recordCommandRun({
      serverId: activeServerId.value || null,
      serverName: form.name,
      host: form.host,
      port: Number(form.port || 22),
      username: form.username,
      command: response.command || commandText.value.trim(),
      status: response.ok ? 'success' : 'failed',
      exitCode: response.exitCode,
      durationMs: response.durationMs,
      stdout: response.stdout || '',
      stderr: response.stderr || '',
    })

    commandRuns.value = [savedRun, ...commandRuns.value].slice(0, 50)
  } catch (error) {
    logs.value.push(logLine(`保存命令记录失败: ${error?.message || error}`))
  }
}

/**
 * 记录一次镜像包生成流水。
 */
async function recordImagePackage(response) {
  const bridge = getStorageBridge()

  if (!bridge?.history?.recordImagePackage) {
    return
  }

  try {
    return await bridge.history.recordImagePackage({
      ok: response.ok,
      message: response.message,
      packageFileName: response.packageFileName,
      packagePath: response.packagePath,
      imageRef: response.imageRef,
      serviceName: response.serviceName,
      serviceVersion: response.serviceVersion,
      servicePort: response.servicePort,
      javaVersion: response.javaVersion,
      baseImage: response.baseImage,
      useNonRootUser: response.useNonRootUser,
      appUser: response.appUser,
      durationMs: response.durationMs,
    })
  } catch (error) {
    logs.value.push(logLine(`保存镜像包记录失败: ${error?.message || error}`))
  }

  return null
}

/**
 * 在内存中维护部署/镜像包记录。
 */
function upsertDeployment(deployment) {
  const index = deployments.value.findIndex((item) => item.id === deployment.id)

  if (index >= 0) {
    deployments.value.splice(index, 1, deployment)
  } else {
    deployments.value.unshift(deployment)
  }

  deployments.value.sort((left, right) => {
    return String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
  })
}

/**
 * 把表单状态转换成主进程保存服务器需要的 payload。
 */
function toServerPayload(overrides = {}) {
  return {
    id: activeServerId.value || undefined,
    name: form.name,
    host: form.host,
    port: Number(form.port || 22),
    username: form.username,
    authType: form.authType,
    privateKeyPath: form.authType === 'privateKey' ? form.privateKeyPath : '',
    password: form.authType === 'password' ? form.password : '',
    rememberPassword: form.authType === 'password' && form.rememberPassword,
    timeoutMs: Number(form.timeoutMs || 10000),
    lastStatus: result.value?.ok ? 'connected' : result.value ? 'failed' : 'idle',
    lastMessage: result.value?.message || '',
    lastConnectedAt: result.value?.ok ? new Date().toISOString() : null,
    ...overrides,
  }
}

/**
 * 在内存列表中新增或替换服务器，并按更新时间倒序排列。
 */
function upsertSavedServer(server) {
  const index = savedServers.value.findIndex((item) => item.id === server.id)

  if (index >= 0) {
    savedServers.value.splice(index, 1, server)
  } else {
    savedServers.value.unshift(server)
  }

  savedServers.value.sort((left, right) => {
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
  })
}

/**
 * 获取 preload 暴露的 SSH API。
 */
function getSshBridge() {
  return globalThis.window?.cendlink?.ssh ?? null
}

/**
 * 获取 preload 暴露的 Docker API。
 */
function getDockerBridge() {
  return globalThis.window?.cendlink?.docker ?? null
}

/**
 * 获取 preload 暴露的完整数据桥。
 */
function getStorageBridge() {
  return globalThis.window?.cendlink ?? null
}

/**
 * 将多行命令格式化为类似 shell 的展示形式。
 */
function formatCommandLines(command) {
  return command.split(/\r?\n/).map((lineContent, index) => {
    return `${index === 0 ? '$' : '>'} ${lineContent}`
  })
}

/**
 * 生成命令摘要，避免日志标题过长。
 */
function summarizeCommand(command) {
  return command.replace(/\s+/g, ' ').slice(0, 80)
}

/**
 * 把 stdout/stderr 字符串拆成日志行。
 */
function toDisplayLines(output) {
  return output.replace(/\r\n/g, '\n').split('\n')
}

/**
 * 生成带时间前缀的日志行。
 */
function logLine(message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })

  return `[${time}] ${message}`
}

/**
 * 对外暴露工作区会话。
 * 这是连接页、命令页、历史页和侧边栏共享状态的唯一入口。
 */
export function useWorkspaceSession() {
  return {
    form,
    packageForm,
    packagePreview,
    packageResult,
    isBuildingPackage,
    result,
    commandResult,
    commandText,
    savedServers,
    commandRuns,
    deployments,
    activeServerId,
    storageInfo,
    isTesting,
    isExecutingCommand,
    isLoadingStoredData,
    isSavingServer,
    logs,
    hasElectronBridge,
    hasStorageBridge,
    needsRetest,
    canExecuteCommand,
    canBuildImagePackage,
    commandHint,
    packageHint,
    loadStoredData,
    selectJarFile,
    refreshPackagePreview,
    buildImagePackage,
    recordImagePackage,
    saveCurrentServer,
    selectSavedServer,
    updateForm,
    updateCommandText,
    updatePackageForm,
    testConnection,
    executeCommand,
    selectPrivateKeyFile,
    clearLogs,
  }
}
