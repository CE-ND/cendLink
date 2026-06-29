import { computed, reactive, ref } from 'vue'
import {
  BUILTIN_DOCKERFILE_TEMPLATES,
  DEFAULT_DOCKERFILE_TEMPLATE_ID,
  createDockerfileTemplateText,
  getDockerfileTemplateById,
  getDockerfileTemplateDefaults,
  parseDockerfileText,
} from '../../../shared/dockerfileTemplates.js'
import { buildServerMetricsCommand, parseServerMetrics } from '../../connections/utils/serverMetrics.js'

const DEFAULT_COMMAND_TIMEOUT_SECONDS = 60
const MIN_COMMAND_TIMEOUT_SECONDS = 5
const MAX_COMMAND_TIMEOUT_SECONDS = 600
const DEFAULT_FRONTEND_REMOTE_BASE_DIR = '/opt/app/nginx/html'
const DEFAULT_FRONTEND_REMOTE_UPLOAD_DIR = '/opt/cendlink/frontend-packages'
const DEFAULT_FRONTEND_ENTRY_FILE = 'index.html'

// 渲染进程共享会话状态。各个页面通过它复用 SSH 上下文，避免切页后状态丢失。
function createDefaultServerForm() {
  return {
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
  }
}

const form = reactive(createDefaultServerForm())

// 最近一次连接测试结果。
const result = ref(null)
// 最近一次远程命令执行结果。
const commandResult = ref(null)
// 已连接服务器的资源占用（CPU/内存/磁盘），手动刷新。
const serverMetrics = ref(null)
// 资源数据读取中状态。
const isLoadingMetrics = ref(false)
// 资源数据读取错误信息。
const metricsError = ref('')
// 命令输入框内容。
const commandText = ref('')
const defaultDockerfileTemplate = getDockerfileTemplateDefaults(DEFAULT_DOCKERFILE_TEMPLATE_ID)
// Jar 打镜像包页的表单对象。
const packageForm = reactive({
  jarPath: '',
  serviceName: 'demo-service',
  serviceVersion: '1.0.0',
  servicePort: 8080,
  javaVersion: defaultDockerfileTemplate.javaVersion,
  javaOpts: defaultDockerfileTemplate.javaOpts,
  baseImage: defaultDockerfileTemplate.baseImage,
  baseImageFamily: defaultDockerfileTemplate.baseImageFamily,
  useNonRootUser: defaultDockerfileTemplate.useNonRootUser,
  appUser: defaultDockerfileTemplate.appUser,
  dockerfileTemplateId: defaultDockerfileTemplate.templateId,
  dockerfileTemplateName: defaultDockerfileTemplate.templateName,
  dockerfileTemplateDescription: defaultDockerfileTemplate.templateDescription,
  dockerfileSourceType: defaultDockerfileTemplate.sourceType,
  dockerfileTemplateText: '',
})
// 远程部署页的表单对象。
const deployForm = reactive({
  packageSourceType: 'history',
  localPackagePath: '',
  serviceName: 'demo-service',
  serviceVersion: '1.0.0',
  imageName: 'demo-service',
  imageTag: '1.0.0',
  containerName: 'demo-service',
  hostPort: 8080,
  containerPort: 8080,
  remoteBaseDir: '/mnt/temp_check',
  remotePackageDir: '/opt/cendlink/packages',
  restartPolicy: 'unless-stopped',
  envText: 'SPRING_PROFILES_ACTIVE=prod\nTZ=Asia/Shanghai',
  extraArgs: '',
  containerConflictStrategy: 'auto',
  imageCleanupStrategy: 'auto',
  directoryPermissionMode: 'none',
})
const frontendForm = reactive({
  localArchivePath: '',
  projectName: 'demo-frontend',
  projectDir: 'demo-frontend',
  remoteBaseDir: DEFAULT_FRONTEND_REMOTE_BASE_DIR,
  remoteTargetDir: `${DEFAULT_FRONTEND_REMOTE_BASE_DIR}/demo-frontend`,
  remoteUploadDir: DEFAULT_FRONTEND_REMOTE_UPLOAD_DIR,
  extractStrategy: 'clean',
  keepRemoteArchive: false,
  entryFile: DEFAULT_FRONTEND_ENTRY_FILE,
})
// 镜像包预览配置。
const packagePreview = ref(null)
// 镜像包构建结果。
const packageResult = ref(null)
// 部署计划预览。
const deployPreview = ref(null)
// 部署执行结果。
const deployResult = ref(null)
const frontendUploadPreview = ref(null)
const frontendUploadResult = ref(null)
// 镜像包构建中状态。
const isBuildingPackage = ref(false)
// 远程部署进行中状态。
const isDeploying = ref(false)
const isUploadingFrontend = ref(false)
// 连接测试进行中状态。
const isTesting = ref(false)
// 远程命令执行中状态。
const isExecutingCommand = ref(false)
// 本地数据库初始化/读取中状态。
const isLoadingStoredData = ref(false)
// 保存服务器配置进行中状态。
const isSavingServer = ref(false)
// 保存自定义 Dockerfile 模板进行中状态。
const isSavingDockerfileTemplate = ref(false)
// 保存服务模板进行中状态。
const isSavingServiceTemplate = ref(false)
const isSavingFrontendProject = ref(false)
// 删除部署记录进行中状态。
const deletingDeploymentIds = ref([])
// 本地数据库中已保存的服务器列表。
const savedServers = ref([])
// 本地数据库中最近的命令执行记录。
const commandRuns = ref([])
// 本地数据库中最近的部署/镜像包记录。
const deployments = ref([])
// 用户保存的自定义 Dockerfile 模板。内置模板来自共享模块，不写入数据库。
const savedDockerfileTemplates = ref([])
// 用户保存的服务模板。服务模板与 Dockerfile 模板分层保存。
const serviceTemplates = ref([])
const frontendProjects = ref([])
// 当前选中的服务模板 id；镜像打包页和远程部署页共享同一个业务服务上下文。
const selectedServiceTemplateId = ref('')
const selectedFrontendProjectId = ref('')
// 工作区级别设置，保存到 app_settings。
const workspaceSettings = reactive({
  commandTimeoutSeconds: DEFAULT_COMMAND_TIMEOUT_SECONDS,
})
const settingsResult = ref(null)
const isSavingSettings = ref(false)
// 当前选中的已保存服务器 id；空字符串代表尚未保存或未选中。
const activeServerId = ref('')
// 当前被设为默认启动目标的服务器 id。
const pinnedServerId = ref('')
// ~/.cendLink 存储目录信息。
const storageInfo = ref(null)
// 最近一次成功发起连接测试时的表单快照，用于判断配置是否已变更。
const lastTestedSnapshot = ref('')
// 避免多页面重复读取数据库。
const hasLoadedStoredData = ref(false)
// 避免应用挂载后重复触发默认服务器自动恢复。
const hasRestoredPinnedServer = ref(false)
// 底部 Activity Log 展示的日志行。
const logs = ref([
  logLine('连接模块已就绪'),
  logLine('通过 Electron 启动后，可以执行真实 SSH 连接测试和远程命令'),
])

const hasElectronBridge = computed(() => {
  const bridge = getStorageBridge()
  const ssh = bridge?.ssh
  const docker = bridge?.docker
  const deployment = bridge?.deployment

  return Boolean(
    ssh?.testConnection &&
      ssh?.executeCommand &&
      ssh?.selectPrivateKeyFile &&
      docker?.selectJarFile &&
      docker?.buildImagePackage &&
      deployment?.preview &&
      deployment?.run,
  )
})

const hasDeploymentBridge = computed(() => {
  const bridge = getStorageBridge()
  const deployment = bridge?.deployment

  return Boolean(deployment?.selectPackageFile && deployment?.preview && deployment?.run)
})

const hasStorageBridge = computed(() => {
  const bridge = getStorageBridge()

  return Boolean(
    bridge?.servers?.list &&
      bridge?.servers?.save &&
      bridge?.history?.listDeployments &&
      bridge?.history?.recordCommandRun &&
      bridge?.history?.recordImagePackage &&
      bridge?.history?.recordRemoteDeployment &&
      bridge?.history?.deleteDeployment &&
      bridge?.settings?.get &&
      bridge?.settings?.set,
  )
})

const hasDockerfileTemplateBridge = computed(() => {
  const bridge = getStorageBridge()

  return Boolean(
    bridge?.dockerfileTemplates?.list &&
      bridge?.dockerfileTemplates?.save &&
      bridge?.dockerfileTemplates?.delete,
  )
})

const hasServiceTemplateBridge = computed(() => {
  const bridge = getStorageBridge()

  return Boolean(
    bridge?.serviceTemplates?.list &&
      bridge?.serviceTemplates?.save &&
      bridge?.serviceTemplates?.delete,
  )
})

const hasFrontendUploadBridge = computed(() => {
  const bridge = getStorageBridge()
  const frontendUpload = bridge?.frontendUpload

  return Boolean(frontendUpload?.selectArchiveFile && frontendUpload?.preview && frontendUpload?.run)
})

const hasFrontendProjectBridge = computed(() => {
  const bridge = getStorageBridge()

  return Boolean(
    bridge?.frontendProjects?.list &&
      bridge?.frontendProjects?.save &&
      bridge?.frontendProjects?.delete,
  )
})

const dockerfileTemplateOptions = computed(() => {
  const options = [...BUILTIN_DOCKERFILE_TEMPLATES, ...savedDockerfileTemplates.value]
  const hasCurrentTemplate = options.some((template) => template.id === packageForm.dockerfileTemplateId)

  if (!hasCurrentTemplate && packageForm.dockerfileSourceType === 'custom') {
    return [
      {
        id: packageForm.dockerfileTemplateId || 'imported-custom',
        name: packageForm.dockerfileTemplateName || '当前导入 Dockerfile',
        description: packageForm.dockerfileTemplateDescription || '未保存的导入内容',
        sourceType: 'custom',
        templateText: packageForm.dockerfileTemplateText,
      },
      ...options,
    ]
  }

  return options
})

const selectedDockerfileTemplate = computed(() => {
  return (
    dockerfileTemplateOptions.value.find(
      (template) => template.id === packageForm.dockerfileTemplateId,
    ) || dockerfileTemplateOptions.value[0]
  )
})

const selectedServiceTemplate = computed(() => {
  return serviceTemplates.value.find((template) => template.id === selectedServiceTemplateId.value) || null
})

const selectedFrontendProject = computed(() => {
  return frontendProjects.value.find((project) => project.id === selectedFrontendProjectId.value) || null
})

// 当前是否处于新建服务器模式。没有 activeServerId 时，保存会创建一条新记录。
const isCreatingServer = computed(() => !activeServerId.value)

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
      Number(packageForm.servicePort || 0) > 0 &&
      (packageForm.dockerfileSourceType !== 'custom' ||
        Boolean(packageForm.dockerfileTemplateText?.trim())),
  )
})

// 当前部署配置是否完整。
const canDeploy = computed(() => {
  return Boolean(
    hasElectronBridge.value &&
      activeServerId.value &&
      deployForm.localPackagePath &&
      deployForm.containerName.trim() &&
      deployForm.imageName.trim() &&
      deployForm.imageTag.trim() &&
      Number.isInteger(Number(deployForm.hostPort || 0)) &&
      Number(deployForm.hostPort || 0) > 0 &&
      Number.isInteger(Number(deployForm.containerPort || 0)) &&
      Number(deployForm.containerPort || 0) > 0 &&
      !isDeploying.value,
  )
})

const canUploadFrontend = computed(() => {
  return Boolean(
    hasElectronBridge.value &&
      hasFrontendUploadBridge.value &&
      activeServerId.value &&
      frontendForm.localArchivePath &&
      frontendForm.projectName.trim() &&
      frontendForm.projectDir.trim() &&
      frontendForm.remoteBaseDir.trim() &&
      frontendForm.remoteTargetDir.trim() &&
      !isUploadingFrontend.value,
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

// 部署页提示。
const deployHint = computed(() => {
  if (!hasDeploymentBridge.value) {
    return '部署模块还没有挂到当前 Electron 进程上，请完全关闭桌面窗口后重新执行 npm run dev:electron。'
  }

  if (!hasElectronBridge.value) {
    return '请通过 Electron 模式启动应用后再执行远程部署。'
  }

  if (!activeServerId.value) {
    return '请先选择一个已保存服务器作为部署目标。'
  }

  if (!deployForm.localPackagePath) {
    return '请选择一个镜像包 tar.gz，或先在镜像打包页生成本地包。'
  }

  if (isDeploying.value) {
    return '部署执行中，请等待服务器返回结果。'
  }

  return '将先检查端口占用，再按预览命令上传镜像包、docker load、创建目录并启动新容器。'
})

const frontendUploadHint = computed(() => {
  if (!hasFrontendUploadBridge.value) {
    return '前端上传模块还没有挂到当前 Electron 进程上，请完全关闭桌面窗口后重新执行 npm run dev:electron。'
  }

  if (!hasElectronBridge.value) {
    return '请通过 Electron 模式启动应用后再上传前端包。'
  }

  if (!activeServerId.value) {
    return '请先选择一个已保存服务器作为上传目标。'
  }

  if (!frontendForm.projectName.trim() || !frontendForm.projectDir.trim()) {
    return '请填写前端项目名称和项目目录。'
  }

  if (!frontendForm.localArchivePath) {
    return '请选择前端构建后的压缩包，支持 zip、tar、tar.gz、tgz。'
  }

  if (isUploadingFrontend.value) {
    return '前端上传执行中，请等待服务器返回结果。'
  }

  return '会先上传压缩包，再在远程临时目录解压校验，最后发布到 Nginx 项目目录。'
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
    serverMetrics.value = null
    metricsError.value = ''
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
 * 切换 Dockerfile 模板，并把模板推荐的运行环境回填到打包表单。
 */
function selectDockerfileTemplate(templateId) {
  const selected = dockerfileTemplateOptions.value.find((template) => template.id === templateId)

  if (!selected) {
    logs.value.push(logLine('未找到要切换的 Dockerfile 模板'))
    return
  }

  const builtin = getDockerfileTemplateById(selected.id)

  if (builtin) {
    const defaults = getDockerfileTemplateDefaults(selected.id)

    updatePackageForm({
      javaVersion: defaults.javaVersion,
      javaOpts: defaults.javaOpts,
      baseImage: defaults.baseImage,
      baseImageFamily: defaults.baseImageFamily,
      useNonRootUser: defaults.useNonRootUser,
      appUser: defaults.appUser,
      dockerfileTemplateId: defaults.templateId,
      dockerfileTemplateName: defaults.templateName,
      dockerfileTemplateDescription: defaults.templateDescription,
      dockerfileSourceType: defaults.sourceType,
      dockerfileTemplateText: '',
    })
    logs.value.push(logLine(`已切换 Dockerfile 模板: ${defaults.templateName}`))
    return
  }

  const parsed = readTemplateMetadata(selected)

  updatePackageForm({
    servicePort: Number(parsed.servicePort || packageForm.servicePort || 8080),
    javaVersion: parsed.javaVersion || packageForm.javaVersion,
    javaOpts: parsed.javaOpts || packageForm.javaOpts,
    baseImage: parsed.baseImage || packageForm.baseImage,
    baseImageFamily: parsed.baseImageFamily || packageForm.baseImageFamily,
    useNonRootUser: parsed.useNonRootUser,
    appUser: parsed.appUser || packageForm.appUser,
    dockerfileTemplateId: selected.id,
    dockerfileTemplateName: selected.name,
    dockerfileTemplateDescription: selected.description || parsed.templateDescription || '',
    dockerfileSourceType: selected.sourceType || 'custom',
    dockerfileTemplateText: selected.templateText || '',
  })
  logs.value.push(logLine(`已切换 Dockerfile 模板: ${selected.name}`))
}

/**
 * 识别用户粘贴的 Dockerfile，并把可识别字段回填到打包表单。
 */
function applyImportedDockerfileTemplate(dockerfileText, templateName = '') {
  const rawText = String(dockerfileText || '').trim()

  if (!rawText) {
    logs.value.push(logLine('请先粘贴 Dockerfile 内容'))
    return null
  }

  const parsed = parseDockerfileText(rawText)
  const templateText = createDockerfileTemplateText(rawText, parsed)
  const name = String(templateName || '').trim() || `导入 · ${parsed.templateName || 'Dockerfile'}`

  updatePackageForm({
    servicePort: Number(parsed.servicePort || packageForm.servicePort || 8080),
    javaVersion: parsed.javaVersion || packageForm.javaVersion,
    javaOpts: parsed.javaOpts || packageForm.javaOpts,
    baseImage: parsed.baseImage || packageForm.baseImage,
    baseImageFamily: parsed.baseImageFamily || packageForm.baseImageFamily,
    useNonRootUser: parsed.useNonRootUser,
    appUser: parsed.appUser || packageForm.appUser,
    dockerfileTemplateId: 'imported-custom',
    dockerfileTemplateName: name,
    dockerfileTemplateDescription: '来自导入识别的未保存 Dockerfile',
    dockerfileSourceType: 'custom',
    dockerfileTemplateText: templateText,
  })
  logs.value.push(logLine(`已识别并应用 Dockerfile: ${parsed.templateName}`))

  return parsed
}

/**
 * 保存当前导入的 Dockerfile 为可复用模板。
 */
async function saveDockerfileTemplate(input = {}) {
  const bridge = getStorageBridge()
  const rawText = String(
    input.templateText || packageForm.dockerfileTemplateText || packagePreview.value?.dockerfileText || '',
  ).trim()

  if (!bridge?.dockerfileTemplates?.save) {
    logs.value.push(logLine('当前 Electron 进程还没有模板存储能力，请重启桌面窗口后再试'))
    return null
  }

  if (!rawText) {
    logs.value.push(logLine('保存模板前请先导入或生成 Dockerfile 内容'))
    return null
  }

  const parsed = input.metadata || parseDockerfileText(rawText)
  const templateText = createDockerfileTemplateText(rawText, parsed)
  const templateMetadata = { ...parsed }
  delete templateMetadata.rawText
  const name = String(input.name || '').trim() || packageForm.dockerfileTemplateName || '自定义 Dockerfile'

  isSavingDockerfileTemplate.value = true

  try {
    const saved = await bridge.dockerfileTemplates.save({
      id: input.id,
      name,
      description: String(input.description || packageForm.dockerfileTemplateDescription || '').trim(),
      sourceType: 'custom',
      templateText,
      baseImageFamily: parsed.baseImageFamily,
      javaVersion: parsed.javaVersion,
      javaOpts: parsed.javaOpts,
      useNonRootUser: parsed.useNonRootUser,
      appUser: parsed.appUser,
      metadata: templateMetadata,
    })

    upsertSavedDockerfileTemplate(saved)
    selectDockerfileTemplate(saved.id)
    logs.value.push(logLine(`Dockerfile 模板已保存: ${saved.name}`))
    return saved
  } catch (error) {
    logs.value.push(logLine(`保存 Dockerfile 模板失败: ${error?.message || error}`))
    return null
  } finally {
    isSavingDockerfileTemplate.value = false
  }
}

/**
 * 删除一个用户自定义 Dockerfile 模板。
 */
async function deleteDockerfileTemplate(templateId) {
  const bridge = getStorageBridge()
  const targetId = String(templateId || '').trim()

  if (!targetId || getDockerfileTemplateById(targetId)) {
    return
  }

  if (!bridge?.dockerfileTemplates?.delete) {
    logs.value.push(logLine('当前 Electron 进程还没有模板删除能力，请重启桌面窗口后再试'))
    return
  }

  try {
    const result = await bridge.dockerfileTemplates.delete(targetId)

    if (result?.deleted) {
      savedDockerfileTemplates.value = savedDockerfileTemplates.value.filter(
        (template) => template.id !== targetId,
      )

      if (packageForm.dockerfileTemplateId === targetId) {
        selectDockerfileTemplate(DEFAULT_DOCKERFILE_TEMPLATE_ID)
      }

      logs.value.push(logLine('Dockerfile 模板已删除'))
    }
  } catch (error) {
    logs.value.push(logLine(`删除 Dockerfile 模板失败: ${error?.message || error}`))
  }
}

/**
 * 切换服务模板。服务模板是业务服务配置，不等同于 Dockerfile 模板。
 */
function selectServiceTemplate(templateId, scope = 'package') {
  const targetId = String(templateId || '').trim()

  if (!targetId) {
    selectedServiceTemplateId.value = ''
    return
  }

  const selected = serviceTemplates.value.find((template) => template.id === targetId)

  if (!selected) {
    logs.value.push(logLine('未找到要切换的服务模板'))
    return
  }

  selectedServiceTemplateId.value = selected.id

  if (scope === 'deploy') {
    applyServiceTemplateToDeploy(selected)
  } else if (scope === 'all') {
    applyServiceTemplateToPackage(selected)
    applyServiceTemplateToDeploy(selected)
  } else {
    applyServiceTemplateToPackage(selected)
  }

  logs.value.push(logLine(`已应用服务模板: ${selected.name}`))
}

/**
 * 保存当前打包页字段为服务模板的打包配置。
 */
async function saveServiceTemplateFromPackage(options = {}) {
  const existing = getServiceTemplateForSave(options)
  const payload = buildServiceTemplatePayload(existing, {
    name: options.name,
    description: options.description,
    packageConfig: readPackageTemplateConfig(),
    deployConfig: existing?.deployConfig || deriveDeployConfigFromPackage(),
  })

  return saveServiceTemplatePayload(payload, '服务打包模板已保存')
}

/**
 * 保存当前部署页字段为服务模板的部署配置。
 */
async function saveServiceTemplateFromDeploy(options = {}) {
  const existing = getServiceTemplateForSave(options)
  const payload = buildServiceTemplatePayload(existing, {
    name: options.name,
    description: options.description,
    packageConfig: existing?.packageConfig || derivePackageConfigFromDeploy(),
    deployConfig: readDeployTemplateConfig(),
  })

  return saveServiceTemplatePayload(payload, '服务部署模板已保存')
}

/**
 * 删除一个服务模板。
 */
async function deleteServiceTemplate(templateId = selectedServiceTemplateId.value) {
  const bridge = getStorageBridge()
  const targetId = String(templateId || '').trim()

  if (!targetId) {
    return
  }

  if (!bridge?.serviceTemplates?.delete) {
    logs.value.push(logLine('当前 Electron 进程还没有服务模板能力，请重启桌面窗口后再试'))
    return
  }

  try {
    const result = await bridge.serviceTemplates.delete(targetId)

    if (result?.deleted) {
      serviceTemplates.value = serviceTemplates.value.filter((template) => template.id !== targetId)

      if (selectedServiceTemplateId.value === targetId) {
        selectedServiceTemplateId.value = ''
      }

      logs.value.push(logLine('服务模板已删除'))
    }
  } catch (error) {
    logs.value.push(logLine(`删除服务模板失败: ${error?.message || error}`))
  }
}

async function saveFrontendProjectFromForm(options = {}) {
  const existing = getFrontendProjectForSave(options)
  const payload = buildFrontendProjectPayload(existing, {
    name: options.name,
  })

  return saveFrontendProjectPayload(payload, existing ? '前端项目已更新' : '前端项目已保存')
}

async function deleteFrontendProject(projectId = selectedFrontendProjectId.value) {
  const bridge = getStorageBridge()
  const targetId = String(projectId || '').trim()

  if (!targetId) {
    return
  }

  if (!bridge?.frontendProjects?.delete) {
    logs.value.push(logLine('当前 Electron 进程还没有前端项目能力，请重启桌面窗口后再试'))
    return
  }

  try {
    const result = await bridge.frontendProjects.delete(targetId)

    if (result?.deleted) {
      frontendProjects.value = frontendProjects.value.filter((project) => project.id !== targetId)

      if (selectedFrontendProjectId.value === targetId) {
        selectedFrontendProjectId.value = ''
      }

      logs.value.push(logLine('前端项目已删除'))
    }
  } catch (error) {
    logs.value.push(logLine(`删除前端项目失败: ${error?.message || error}`))
  }
}

function getFrontendProjectForSave(options = {}) {
  if (options.createNew) {
    return null
  }

  const targetId = String(options.id || selectedFrontendProjectId.value || '').trim()
  return frontendProjects.value.find((project) => project.id === targetId) || null
}

function buildFrontendProjectPayload(existing, overrides = {}) {
  const config = readFrontendProjectConfig()
  const name = String(overrides.name || existing?.name || config.name || '').trim() || '未命名前端项目'

  return {
    id: existing?.id,
    name,
    projectDir: config.projectDir,
    remoteBaseDir: config.remoteBaseDir,
    remoteTargetDir: config.remoteTargetDir,
    remoteUploadDir: config.remoteUploadDir,
    extractStrategy: config.extractStrategy,
    keepRemoteArchive: config.keepRemoteArchive,
    entryFile: config.entryFile,
    lastPackagePath: String(overrides.lastPackagePath ?? existing?.lastPackagePath ?? config.lastPackagePath ?? ''),
    lastUploadedAt: overrides.lastUploadedAt ?? existing?.lastUploadedAt ?? null,
    lastServerId: overrides.lastServerId ?? existing?.lastServerId ?? activeServerId.value ?? null,
    createdAt: existing?.createdAt,
  }
}

async function saveFrontendProjectPayload(payload, successMessage) {
  const bridge = getStorageBridge()

  if (!bridge?.frontendProjects?.save) {
    logs.value.push(logLine('当前 Electron 进程还没有前端项目能力，请重启桌面窗口后再试'))
    return null
  }

  if (!payload.name || !payload.projectDir) {
    logs.value.push(logLine('保存前端项目前请先填写项目名称和项目目录'))
    return null
  }

  isSavingFrontendProject.value = true

  try {
    const saved = await bridge.frontendProjects.save(payload)
    upsertFrontendProject(saved)
    selectedFrontendProjectId.value = saved.id
    logs.value.push(logLine(`${successMessage}: ${saved.name}`))
    return saved
  } catch (error) {
    logs.value.push(logLine(`保存前端项目失败: ${error?.message || error}`))
    return null
  } finally {
    isSavingFrontendProject.value = false
  }
}

async function syncFrontendUploadResultToProject(response) {
  if (!response?.ok || !selectedFrontendProjectId.value) {
    return
  }

  const existing = selectedFrontendProject.value

  if (!existing) {
    return
  }

  const payload = buildFrontendProjectPayload(existing, {
    lastPackagePath: response.localArchivePath || frontendForm.localArchivePath,
    lastUploadedAt: response.finishedAt || new Date().toISOString(),
    lastServerId: activeServerId.value || existing.lastServerId || null,
  })

  await saveFrontendProjectPayload(payload, '前端项目已同步本次上传结果')
}

/**
 * 更新部署表单，并刷新 docker run 预览。
 */
function updateDeployForm(nextValue) {
  const next = nextValue || {}
  const hasContainerPort = Object.prototype.hasOwnProperty.call(next, 'containerPort')
  const hasHostPort = Object.prototype.hasOwnProperty.call(next, 'hostPort')
  const nextContainerPort = Number(next.containerPort || 0)
  const shouldSyncHostPort =
    hasContainerPort &&
    !hasHostPort &&
    nextContainerPort > 0 &&
    (Number(deployForm.hostPort || 0) <= 0 || Number(deployForm.hostPort || 0) === Number(deployForm.containerPort || 0))
  const merged = shouldSyncHostPort ? { ...next, hostPort: nextContainerPort } : next

  Object.assign(deployForm, merged)
  deployPreview.value = null
  deployResult.value = null
  void refreshDeployPreview()
}

function updateFrontendForm(nextValue) {
  const next = nextValue || {}
  const hasBaseDir = Object.prototype.hasOwnProperty.call(next, 'remoteBaseDir')
  const hasProjectDir = Object.prototype.hasOwnProperty.call(next, 'projectDir')
  const hasTargetDir = Object.prototype.hasOwnProperty.call(next, 'remoteTargetDir')
  const merged = { ...next }

  if ((hasBaseDir || hasProjectDir) && !hasTargetDir) {
    merged.remoteTargetDir = buildFrontendTargetDir(
      hasBaseDir ? next.remoteBaseDir : frontendForm.remoteBaseDir,
      hasProjectDir ? next.projectDir : frontendForm.projectDir,
    )
  }

  Object.assign(frontendForm, merged)
  frontendUploadPreview.value = null
  frontendUploadResult.value = null
  void refreshFrontendUploadPreview()
}

function updateWorkspaceSettings(nextValue) {
  if (Object.prototype.hasOwnProperty.call(nextValue || {}, 'commandTimeoutSeconds')) {
    workspaceSettings.commandTimeoutSeconds = normalizeCommandTimeoutSeconds(nextValue.commandTimeoutSeconds)
    settingsResult.value = null
  }
}

async function saveWorkspaceSettings() {
  const bridge = getStorageBridge()

  if (!bridge?.settings?.set) {
    settingsResult.value = {
      ok: false,
      message: '当前是浏览器预览模式，无法保存设置',
    }
    return
  }

  const commandTimeoutSeconds = normalizeCommandTimeoutSeconds(workspaceSettings.commandTimeoutSeconds)
  workspaceSettings.commandTimeoutSeconds = commandTimeoutSeconds
  isSavingSettings.value = true

  try {
    await bridge.settings.set('commandTimeoutSeconds', commandTimeoutSeconds)
    settingsResult.value = {
      ok: true,
      message: '设置已保存',
    }
    logs.value.push(logLine(`远程命令超时已设置为 ${commandTimeoutSeconds} 秒`))
  } catch (error) {
    settingsResult.value = {
      ok: false,
      message: `保存设置失败: ${error?.message || error}`,
    }
  } finally {
    isSavingSettings.value = false
  }
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
    const [info, servers, runs, deploymentRows, defaultServerId, commandTimeoutSeconds] = await Promise.all([
      bridge.data.getStorageInfo(),
      bridge.servers.list(),
      bridge.history.listCommandRuns(50),
      bridge.history.listDeployments(50),
      bridge.settings.get('defaultServerId', ''),
      bridge.settings.get('commandTimeoutSeconds', DEFAULT_COMMAND_TIMEOUT_SECONDS),
    ])

    storageInfo.value = info
    savedServers.value = servers
    commandRuns.value = runs
    deployments.value = deploymentRows
    pinnedServerId.value = String(defaultServerId || '')
    workspaceSettings.commandTimeoutSeconds = normalizeCommandTimeoutSeconds(commandTimeoutSeconds)
    savedServers.value.sort(compareSavedServers)
    await loadDockerfileTemplates()
    await loadServiceTemplates()
    await loadFrontendProjects()
    hydrateDeployFormFromHistory()
    hasLoadedStoredData.value = true
    logs.value.push(logLine(`本地数据目录已就绪: ${info.dataDir}`))
    await restorePinnedServerOnLaunch()
  } catch (error) {
    logs.value.push(logLine(`读取本地数据失败: ${error?.message || error}`))
  } finally {
    isLoadingStoredData.value = false
  }
}

/**
 * 从本地数据库读取用户保存的 Dockerfile 模板。
 */
async function loadDockerfileTemplates() {
  const bridge = getStorageBridge()

  if (!bridge?.dockerfileTemplates?.list) {
    return
  }

  try {
    const templates = await bridge.dockerfileTemplates.list()
    savedDockerfileTemplates.value = Array.isArray(templates) ? templates : []
  } catch (error) {
    logs.value.push(logLine(`读取 Dockerfile 模板失败: ${error?.message || error}`))
  }
}

/**
 * 从本地数据库读取用户保存的服务模板。
 */
async function loadServiceTemplates() {
  const bridge = getStorageBridge()

  if (!bridge?.serviceTemplates?.list) {
    return
  }

  try {
    const templates = await bridge.serviceTemplates.list()
    serviceTemplates.value = Array.isArray(templates) ? templates : []

    if (
      selectedServiceTemplateId.value &&
      !serviceTemplates.value.some((template) => template.id === selectedServiceTemplateId.value)
    ) {
      selectedServiceTemplateId.value = ''
    }
  } catch (error) {
    logs.value.push(logLine(`读取服务模板失败: ${error?.message || error}`))
  }
}

async function loadFrontendProjects() {
  const bridge = getStorageBridge()

  if (!bridge?.frontendProjects?.list) {
    return
  }

  try {
    const projects = await bridge.frontendProjects.list()
    frontendProjects.value = Array.isArray(projects) ? projects : []

    if (
      selectedFrontendProjectId.value &&
      !frontendProjects.value.some((project) => project.id === selectedFrontendProjectId.value)
    ) {
      selectedFrontendProjectId.value = ''
    }
  } catch (error) {
    logs.value.push(logLine(`读取前端项目失败: ${error?.message || error}`))
  }
}

function selectFrontendProject(projectId) {
  const targetId = String(projectId || '').trim()

  if (!targetId) {
    selectedFrontendProjectId.value = ''
    return
  }

  const selected = frontendProjects.value.find((project) => project.id === targetId)

  if (!selected) {
    logs.value.push(logLine('未找到要切换的前端项目'))
    return
  }

  selectedFrontendProjectId.value = selected.id
  applyFrontendProject(selected)
  logs.value.push(logLine(`已应用前端项目: ${selected.name}`))
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
 * 选择本地镜像包 tar.gz 文件。
 */
async function selectDeployPackageFile() {
  const deployment = getDeploymentBridge()

  if (!deployment?.selectPackageFile) {
    logs.value.push(logLine('当前是浏览器预览模式，无法打开镜像包选择器'))
    return
  }

  const selected = await deployment.selectPackageFile()

  if (selected?.canceled || !selected?.filePath) {
    logs.value.push(logLine('已取消选择镜像包'))
    return
  }

  applyDeployPackageSelection(selected.filePath)
  logs.value.push(logLine(`已选择镜像包: ${selected.filePath}`))
  await refreshDeployPreview()
}

async function selectFrontendArchiveFile() {
  const frontendUpload = getFrontendUploadBridge()

  if (!frontendUpload?.selectArchiveFile) {
    logs.value.push(logLine('当前是浏览器预览模式，无法打开前端压缩包选择器'))
    return
  }

  const selected = await frontendUpload.selectArchiveFile()

  if (selected?.canceled || !selected?.filePath) {
    logs.value.push(logLine('已取消选择前端压缩包'))
    return
  }

  updateFrontendForm({ localArchivePath: selected.filePath })
  logs.value.push(logLine(`已选择前端压缩包: ${selected.filePath}`))
  await refreshFrontendUploadPreview()
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
 * 刷新部署计划预览，生成远程目录和 docker run 命令。
 */
async function refreshDeployPreview() {
  const deployment = getDeploymentBridge()

  if (!deployment?.preview) {
    return
  }

  try {
    deployPreview.value = await deployment.preview(toDeployPayload())
  } catch (error) {
    deployPreview.value = null
    logs.value.push(logLine(`读取部署预览失败: ${error?.message || error}`))
  }
}

async function refreshFrontendUploadPreview() {
  const frontendUpload = getFrontendUploadBridge()

  if (!frontendUpload?.preview) {
    return
  }

  try {
    frontendUploadPreview.value = await frontendUpload.preview(toFrontendUploadPayload())
  } catch (error) {
    frontendUploadPreview.value = null
    logs.value.push(logLine(`读取前端上传预览失败: ${error?.message || error}`))
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
    await syncPackageResultToServiceTemplate(response)
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
 * 执行远程部署。
 */
async function runDeployment() {
  if (!canDeploy.value) {
    return
  }

  const deployment = getDeploymentBridge()

  if (!deployment?.run) {
    deployResult.value = {
      ok: false,
      status: 'failed',
      message: '当前是浏览器预览模式，无法执行远程部署',
      durationMs: 0,
    }
    return
  }

  const server = savedServers.value.find((item) => item.id === activeServerId.value)

  if (!server) {
    deployResult.value = {
      ok: false,
      status: 'failed',
      message: '请先选择一个有效的服务器配置',
      durationMs: 0,
    }
    return
  }

  isDeploying.value = true
  logs.value = [logLine(`开始部署 ${deployForm.containerName} 到 ${server.name}`)]

  try {
    const response = await deployment.run({ ...form }, toDeployPayload())
    deployResult.value = response
    deployPreview.value = {
      ...(deployPreview.value || {}),
      ...response,
      runCommand: response.runCommand,
      remotePackagePath: response.remotePackagePath,
      remoteReleaseDir: response.remoteReleaseDir,
    }
    logs.value = response.logs?.length ? response.logs : [logLine(response.message)]
    const savedDeployment = await recordRemoteDeployment(response)
    if (savedDeployment) {
      upsertDeployment(savedDeployment)
    }
    await syncDeployResultToServiceTemplate(response)
  } catch (error) {
    deployResult.value = {
      ok: false,
      status: 'failed',
      message: error?.message || '部署失败',
      durationMs: 0,
    }
    logs.value.push(logLine(deployResult.value.message))
  } finally {
    isDeploying.value = false
  }
}

async function runFrontendUpload() {
  if (!canUploadFrontend.value) {
    return
  }

  const frontendUpload = getFrontendUploadBridge()

  if (!frontendUpload?.run) {
    frontendUploadResult.value = {
      ok: false,
      status: 'failed',
      message: '当前是浏览器预览模式，无法执行前端上传',
      durationMs: 0,
    }
    return
  }

  const server = savedServers.value.find((item) => item.id === activeServerId.value)

  if (!server) {
    frontendUploadResult.value = {
      ok: false,
      status: 'failed',
      message: '请先选择一个有效的服务器配置',
      durationMs: 0,
    }
    return
  }

  isUploadingFrontend.value = true
  logs.value = [logLine(`开始上传前端项目 ${frontendForm.projectName} 到 ${server.name}`)]

  try {
    const response = await frontendUpload.run({ ...form }, toFrontendUploadPayload())
    frontendUploadResult.value = response
    frontendUploadPreview.value = {
      ...(frontendUploadPreview.value || {}),
      ...response,
    }
    logs.value = response.logs?.length ? response.logs : [logLine(response.message)]
    const savedDeployment = await recordFrontendUpload(response)
    if (savedDeployment) {
      upsertDeployment(savedDeployment)
    }
    await syncFrontendUploadResultToProject(response)
  } catch (error) {
    frontendUploadResult.value = {
      ok: false,
      status: 'failed',
      message: error?.message || '前端上传失败',
      durationMs: 0,
    }
    logs.value.push(logLine(frontendUploadResult.value.message))
  } finally {
    isUploadingFrontend.value = false
  }
}

/**
 * 打开镜像包输出目录。
 * 若本次已有生成结果，则优先定位到对应的 tar.gz 文件。
 */
async function openImagePackageDirectory() {
  const docker = getDockerBridge()

  if (!docker?.openImagePackageDirectory) {
    logs.value.push(logLine('当前是浏览器预览模式，无法打开镜像包目录'))
    return
  }

  try {
    const response = await docker.openImagePackageDirectory(packageResult.value?.packagePath || '')
    logs.value.push(logLine(`已打开镜像包目录: ${response?.openedPath || 'image-packages'}`))
  } catch (error) {
    logs.value.push(logLine(`打开镜像包目录失败: ${error?.message || error}`))
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
 * 切换到新建服务器模式，并清空当前连接结果。
 * 保存时没有 activeServerId，主进程会把它当作新增服务器处理。
 */
function createNewServer() {
  activeServerId.value = ''
  updateForm(createDefaultServerForm())
  result.value = null
  commandResult.value = null
  serverMetrics.value = null
  metricsError.value = ''
  lastTestedSnapshot.value = ''
  logs.value.push(logLine('已进入新建服务器模式'))
}

/**
 * 将指定服务器设为默认启动目标。
 * 默认服务器会在应用启动时自动加载，并在凭据完整时尝试自动连接。
 */
async function pinServer(serverId) {
  const bridge = getStorageBridge()
  const nextServerId = String(serverId || '')

  if (!bridge?.settings?.set) {
    logs.value.push(logLine('当前是浏览器预览模式，无法设置默认服务器'))
    return
  }

  const targetServer = savedServers.value.find((item) => item.id === nextServerId)

  if (!targetServer) {
    logs.value.push(logLine('未找到要置顶的服务器'))
    return
  }

  const isCanceling = pinnedServerId.value === nextServerId
  const finalServerId = isCanceling ? '' : nextServerId

  await bridge.settings.set('defaultServerId', finalServerId)
  pinnedServerId.value = finalServerId
  savedServers.value.sort(compareSavedServers)

  logs.value.push(
    logLine(
      isCanceling ? `已取消默认服务器: ${targetServer.name}` : `已设为默认服务器: ${targetServer.name}`,
    ),
  )
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
  serverMetrics.value = null
  metricsError.value = ''
  lastTestedSnapshot.value = ''
  logs.value.push(logLine(`已载入服务器配置: ${server.name}`))
}

/**
 * 从历史镜像包记录中带出最近一条成功记录，作为部署页默认值。
 */
function hydrateDeployFormFromHistory() {
  const latestPackage = deployments.value.find((item) => item.status === 'package_success')

  if (!latestPackage) {
    return
  }

  const nextValues = inferDeployDefaultsFromDeployment(latestPackage)

  if (!nextValues.localPackagePath) {
    return
  }

  Object.assign(deployForm, nextValues)
  void refreshDeployPreview()
}

/**
 * 应用启动后恢复默认服务器。
 * 规则：
 * - 只执行一次，避免反复打断用户当前输入。
 * - 默认先回填表单。
 * - 若凭据完整且 Electron SSH 可用，则自动发起一次连接测试。
 */
async function restorePinnedServerOnLaunch() {
  if (hasRestoredPinnedServer.value) {
    return
  }

  hasRestoredPinnedServer.value = true

  const serverId = String(pinnedServerId.value || '')

  if (!serverId) {
    return
  }

  const server = savedServers.value.find((item) => item.id === serverId)

  if (!server) {
    logs.value.push(logLine('默认服务器不存在，已跳过启动恢复'))
    return
  }

  selectSavedServer(serverId)
  logs.value.push(logLine(`已恢复默认服务器: ${server.name}`))

  if (!hasElectronBridge.value) {
    return
  }

  if (!canAutoConnectServer(server)) {
    logs.value.push(logLine('默认服务器凭据不完整，已跳过自动连接'))
    return
  }

  logs.value.push(logLine(`正在自动连接默认服务器: ${server.name}`))
  await testConnection()
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
  serverMetrics.value = null
  metricsError.value = ''
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

    if (response.ok) {
      void refreshServerMetrics()
    }
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
 * 读取已连接服务器的资源占用（CPU/内存/磁盘）。
 * 复用 ssh.executeCommand 跑一条组合探测命令，在渲染层解析。手动触发或连接成功后调用一次。
 */
async function refreshServerMetrics() {
  const ssh = getSshBridge()

  if (!ssh?.executeCommand || !result.value?.ok || needsRetest.value || isLoadingMetrics.value) {
    return
  }

  isLoadingMetrics.value = true
  metricsError.value = ''

  try {
    const response = await ssh.executeCommand(
      {
        ...form,
        commandTimeoutMs: normalizeCommandTimeoutSeconds(workspaceSettings.commandTimeoutSeconds) * 1000,
      },
      buildServerMetricsCommand(),
    )

    // 探测命令里个别项失败可能导致非零退出码，但只要有 stdout 就尽量解析。
    if (!response.stdout) {
      throw new Error(response.message || response.stderr || '读取服务器资源失败')
    }

    serverMetrics.value = parseServerMetrics(response.stdout)
  } catch (error) {
    metricsError.value = error?.message || String(error)
  } finally {
    isLoadingMetrics.value = false
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
  logs.value = [
    ...logs.value,
    ...(logs.value.length ? [''] : []),
    logLine(`开始执行命令: ${summarizeCommand(command)}`),
  ]

  try {
    const response = await ssh.executeCommand(
      {
        ...form,
        commandTimeoutMs: normalizeCommandTimeoutSeconds(workspaceSettings.commandTimeoutSeconds) * 1000,
      },
      command,
    )

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

  if (response.message) {
    nextLines.push(`[status] ${response.message}`)
  }

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
      baseImageFamily: response.baseImageFamily,
      useNonRootUser: response.useNonRootUser,
      appUser: response.appUser,
      dockerfileTemplateId: response.dockerfileTemplateId,
      dockerfileTemplateName: response.dockerfileTemplateName,
      dockerfileTemplateDescription: response.dockerfileTemplateDescription,
      dockerfileSourceType: response.dockerfileSourceType,
      dockerfileTemplateText: response.dockerfileTemplateText,
      dockerfileText: response.dockerfileText,
      durationMs: response.durationMs,
    })
  } catch (error) {
    logs.value.push(logLine(`保存镜像包记录失败: ${error?.message || error}`))
  }

  return null
}

/**
 * 记录一次远程部署流水。
 */
async function recordRemoteDeployment(response) {
  const bridge = getStorageBridge()

  if (!bridge?.history?.recordRemoteDeployment) {
    return null
  }

  try {
    return await bridge.history.recordRemoteDeployment({
      ok: response.ok,
      message: response.message,
      serverId: activeServerId.value || null,
      remotePackagePath: response.remotePackagePath,
      remoteReleaseDir: response.remoteReleaseDir,
      imageRef: response.imageRef,
      containerName: response.containerName,
      runCommand: response.runCommand,
      cleanupCommand: response.cleanupCommand,
      cleanupSummary: response.cleanupSummary,
      durationMs: response.durationMs,
      startedAt: response.startedAt,
      finishedAt: response.finishedAt,
      steps: response.steps || [],
    })
  } catch (error) {
    logs.value.push(logLine(`保存部署记录失败: ${error?.message || error}`))
  }

  return null
}

async function recordFrontendUpload(response) {
  const bridge = getStorageBridge()

  if (!bridge?.history?.recordFrontendUpload) {
    return null
  }

  try {
    return await bridge.history.recordFrontendUpload({
      ...response,
      serverId: activeServerId.value || null,
    })
  } catch (error) {
    logs.value.push(logLine(`保存前端上传记录失败: ${error?.message || error}`))
  }

  return null
}

/**
 * 删除一条部署/镜像包记录，并同步更新本地列表。
 */
async function deleteDeploymentRecord(deploymentId) {
  const bridge = getStorageBridge()
  const normalizedId = String(deploymentId || '')

  if (!normalizedId || !bridge?.history?.deleteDeployment) {
    return
  }

  if (deletingDeploymentIds.value.includes(normalizedId)) {
    return
  }

  deletingDeploymentIds.value = [...deletingDeploymentIds.value, normalizedId]

  try {
    const result = await bridge.history.deleteDeployment(normalizedId)

    if (result?.deleted) {
      deployments.value = deployments.value.filter((item) => item.id !== normalizedId)
      logs.value.push(logLine('已删除一条部署记录'))
      return
    }

    logs.value.push(logLine('未找到要删除的部署记录'))
  } catch (error) {
    logs.value.push(logLine(`删除部署记录失败: ${error?.message || error}`))
  } finally {
    deletingDeploymentIds.value = deletingDeploymentIds.value.filter((item) => item !== normalizedId)
  }
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

function applyServiceTemplateToPackage(template) {
  const config = template?.packageConfig || {}
  const version = template?.lastPackageVersion || config.serviceVersion

  updatePackageForm({
    jarPath: String(config.jarPath || packageForm.jarPath || ''),
    serviceName: String(config.serviceName || template?.serviceName || packageForm.serviceName),
    serviceVersion: String(version || packageForm.serviceVersion),
    servicePort: Number(config.servicePort || packageForm.servicePort || 8080),
    javaVersion: String(config.javaVersion || packageForm.javaVersion),
    javaOpts: String(config.javaOpts || packageForm.javaOpts),
    baseImage: String(config.baseImage || packageForm.baseImage),
    baseImageFamily: String(config.baseImageFamily || packageForm.baseImageFamily),
    useNonRootUser:
      config.useNonRootUser !== undefined ? Boolean(config.useNonRootUser) : packageForm.useNonRootUser,
    appUser: String(config.appUser || packageForm.appUser),
    dockerfileTemplateId: String(config.dockerfileTemplateId || packageForm.dockerfileTemplateId),
    dockerfileTemplateName: String(config.dockerfileTemplateName || packageForm.dockerfileTemplateName),
    dockerfileTemplateDescription: String(
      config.dockerfileTemplateDescription || packageForm.dockerfileTemplateDescription,
    ),
    dockerfileSourceType: String(config.dockerfileSourceType || packageForm.dockerfileSourceType),
    dockerfileTemplateText: String(config.dockerfileTemplateText || packageForm.dockerfileTemplateText || ''),
  })
}

function applyServiceTemplateToDeploy(template) {
  const config = template?.deployConfig || {}
  const serviceName = String(config.serviceName || template?.serviceName || deployForm.serviceName)
  const imageTag = String(template?.lastImageTag || config.imageTag || deployForm.imageTag)
  const serviceVersion = String(template?.lastPackageVersion || config.serviceVersion || imageTag)
  const containerPort = Number(config.containerPort || deployForm.containerPort || 8080)

  updateDeployForm({
    packageSourceType: template?.lastPackagePath ? 'template' : config.packageSourceType || deployForm.packageSourceType,
    localPackagePath: String(template?.lastPackagePath || config.localPackagePath || ''),
    serviceName,
    serviceVersion,
    imageName: String(config.imageName || serviceName || deployForm.imageName).toLowerCase(),
    imageTag,
    containerName: String(config.containerName || serviceName || deployForm.containerName),
    hostPort: Number(config.hostPort || containerPort || deployForm.hostPort || 8080),
    containerPort,
    remoteBaseDir: String(config.remoteBaseDir || deployForm.remoteBaseDir),
    remotePackageDir: String(config.remotePackageDir || deployForm.remotePackageDir),
    restartPolicy: String(config.restartPolicy || deployForm.restartPolicy),
    envText: String(config.envText || deployForm.envText),
    extraArgs: String(config.extraArgs || deployForm.extraArgs || ''),
    containerConflictStrategy: String(config.containerConflictStrategy || deployForm.containerConflictStrategy),
    imageCleanupStrategy: String(config.imageCleanupStrategy || deployForm.imageCleanupStrategy),
    directoryPermissionMode: String(config.directoryPermissionMode || deployForm.directoryPermissionMode),
  })
}

function applyFrontendProject(project) {
  if (!project) {
    return
  }

  updateFrontendForm({
    localArchivePath: String(project.lastPackagePath || frontendForm.localArchivePath || ''),
    projectName: String(project.name || frontendForm.projectName),
    projectDir: String(project.projectDir || frontendForm.projectDir),
    remoteBaseDir: String(project.remoteBaseDir || frontendForm.remoteBaseDir),
    remoteTargetDir: String(
      project.remoteTargetDir ||
        buildFrontendTargetDir(project.remoteBaseDir || frontendForm.remoteBaseDir, project.projectDir || frontendForm.projectDir),
    ),
    remoteUploadDir: String(project.remoteUploadDir || frontendForm.remoteUploadDir),
    extractStrategy: String(project.extractStrategy || frontendForm.extractStrategy),
    keepRemoteArchive: Boolean(project.keepRemoteArchive),
    entryFile: String(project.entryFile || frontendForm.entryFile || DEFAULT_FRONTEND_ENTRY_FILE),
  })
}

function getServiceTemplateForSave(options = {}) {
  if (options.createNew) {
    return null
  }

  const targetId = String(options.id || selectedServiceTemplateId.value || '').trim()
  return serviceTemplates.value.find((template) => template.id === targetId) || null
}

function buildServiceTemplatePayload(existing, overrides = {}) {
  const packageConfig = overrides.packageConfig || existing?.packageConfig || {}
  const deployConfig = overrides.deployConfig || existing?.deployConfig || {}
  const serviceName = String(packageConfig.serviceName || deployConfig.serviceName || existing?.serviceName || '').trim()
  const name = String(overrides.name || existing?.name || serviceName || '').trim() || '未命名服务模板'

  return {
    id: existing?.id,
    name,
    description: String(overrides.description ?? existing?.description ?? '').trim(),
    serviceName,
    packageConfig,
    deployConfig,
    lastPackageVersion: String(overrides.lastPackageVersion ?? existing?.lastPackageVersion ?? '').trim(),
    lastImageTag: String(overrides.lastImageTag ?? existing?.lastImageTag ?? '').trim(),
    lastPackagePath: String(overrides.lastPackagePath ?? existing?.lastPackagePath ?? '').trim(),
    lastPackagedAt: overrides.lastPackagedAt ?? existing?.lastPackagedAt ?? null,
    lastDeployedAt: overrides.lastDeployedAt ?? existing?.lastDeployedAt ?? null,
    createdAt: existing?.createdAt,
  }
}

async function saveServiceTemplatePayload(payload, successMessage) {
  const bridge = getStorageBridge()

  if (!bridge?.serviceTemplates?.save) {
    logs.value.push(logLine('当前 Electron 进程还没有服务模板能力，请重启桌面窗口后再试'))
    return null
  }

  if (!payload.serviceName) {
    logs.value.push(logLine('保存服务模板前请先填写服务名'))
    return null
  }

  isSavingServiceTemplate.value = true

  try {
    const saved = await bridge.serviceTemplates.save(payload)
    upsertServiceTemplate(saved)
    selectedServiceTemplateId.value = saved.id
    logs.value.push(logLine(`${successMessage}: ${saved.name}`))
    return saved
  } catch (error) {
    logs.value.push(logLine(`保存服务模板失败: ${error?.message || error}`))
    return null
  } finally {
    isSavingServiceTemplate.value = false
  }
}

async function syncPackageResultToServiceTemplate(response) {
  if (!response?.ok || !selectedServiceTemplateId.value) {
    return
  }

  const existing = selectedServiceTemplate.value

  if (!existing) {
    return
  }

  const payload = buildServiceTemplatePayload(existing, {
    packageConfig: readPackageTemplateConfig(),
    deployConfig: {
      ...(existing.deployConfig || {}),
      serviceName: response.serviceName || deployForm.serviceName,
      serviceVersion: response.serviceVersion || deployForm.serviceVersion,
      imageName: response.imageName || deployForm.imageName,
      imageTag: response.imageTag || deployForm.imageTag,
      containerName: existing.deployConfig?.containerName || deployForm.containerName || response.serviceName,
      containerPort: Number(response.servicePort || deployForm.containerPort || 8080),
      localPackagePath: response.packagePath || existing.deployConfig?.localPackagePath || '',
    },
    lastPackageVersion: response.serviceVersion,
    lastImageTag: response.imageTag,
    lastPackagePath: response.packagePath,
    lastPackagedAt: new Date().toISOString(),
  })

  await saveServiceTemplatePayload(payload, '服务模板已同步本次打包结果')
}

async function syncDeployResultToServiceTemplate(response) {
  if (!response?.ok || !selectedServiceTemplateId.value) {
    return
  }

  const existing = selectedServiceTemplate.value

  if (!existing) {
    return
  }

  const payload = buildServiceTemplatePayload(existing, {
    deployConfig: readDeployTemplateConfig(),
    lastDeployedAt: new Date().toISOString(),
  })

  await saveServiceTemplatePayload(payload, '服务模板已同步本次部署结果')
}

function readPackageTemplateConfig() {
  return {
    jarPath: packageForm.jarPath,
    serviceName: packageForm.serviceName,
    serviceVersion: packageForm.serviceVersion,
    servicePort: Number(packageForm.servicePort || 0),
    javaVersion: packageForm.javaVersion,
    javaOpts: packageForm.javaOpts,
    baseImage: packageForm.baseImage,
    baseImageFamily: packageForm.baseImageFamily,
    useNonRootUser: Boolean(packageForm.useNonRootUser),
    appUser: packageForm.appUser,
    dockerfileTemplateId: packageForm.dockerfileTemplateId,
    dockerfileTemplateName: packageForm.dockerfileTemplateName,
    dockerfileTemplateDescription: packageForm.dockerfileTemplateDescription,
    dockerfileSourceType: packageForm.dockerfileSourceType,
    dockerfileTemplateText: packageForm.dockerfileTemplateText,
  }
}

function readDeployTemplateConfig() {
  return {
    packageSourceType: deployForm.packageSourceType,
    localPackagePath: deployForm.localPackagePath,
    serviceName: deployForm.serviceName,
    serviceVersion: deployForm.serviceVersion,
    imageName: deployForm.imageName,
    imageTag: deployForm.imageTag,
    containerName: deployForm.containerName,
    hostPort: Number(deployForm.hostPort || deployForm.containerPort || 0),
    containerPort: Number(deployForm.containerPort || 0),
    remoteBaseDir: deployForm.remoteBaseDir,
    remotePackageDir: deployForm.remotePackageDir,
    restartPolicy: deployForm.restartPolicy,
    envText: deployForm.envText,
    extraArgs: deployForm.extraArgs,
    containerConflictStrategy: deployForm.containerConflictStrategy,
    imageCleanupStrategy: deployForm.imageCleanupStrategy,
    directoryPermissionMode: deployForm.directoryPermissionMode,
  }
}

function readFrontendProjectConfig() {
  return {
    name: frontendForm.projectName,
    projectDir: frontendForm.projectDir,
    remoteBaseDir: frontendForm.remoteBaseDir,
    remoteTargetDir: frontendForm.remoteTargetDir,
    remoteUploadDir: frontendForm.remoteUploadDir,
    extractStrategy: frontendForm.extractStrategy,
    keepRemoteArchive: Boolean(frontendForm.keepRemoteArchive),
    entryFile: frontendForm.entryFile,
    lastPackagePath: frontendForm.localArchivePath,
  }
}

function toFrontendUploadPayload() {
  return {
    localArchivePath: frontendForm.localArchivePath,
    projectName: frontendForm.projectName,
    projectDir: frontendForm.projectDir,
    remoteBaseDir: frontendForm.remoteBaseDir,
    remoteTargetDir: frontendForm.remoteTargetDir,
    remoteUploadDir: frontendForm.remoteUploadDir,
    extractStrategy: frontendForm.extractStrategy,
    keepRemoteArchive: Boolean(frontendForm.keepRemoteArchive),
    entryFile: frontendForm.entryFile,
  }
}

function deriveDeployConfigFromPackage() {
  const serviceName = String(packageForm.serviceName || deployForm.serviceName)
  const version = String(packageForm.serviceVersion || deployForm.serviceVersion)

  return {
    ...readDeployTemplateConfig(),
    packageSourceType: 'template',
    localPackagePath: '',
    serviceName,
    serviceVersion: version,
    imageName: serviceName.toLowerCase(),
    imageTag: version,
    containerName: serviceName,
    hostPort: Number(deployForm.hostPort || packageForm.servicePort || 8080),
    containerPort: Number(packageForm.servicePort || deployForm.containerPort || 8080),
  }
}

function derivePackageConfigFromDeploy() {
  return {
    ...readPackageTemplateConfig(),
    serviceName: deployForm.serviceName || packageForm.serviceName,
    serviceVersion: deployForm.serviceVersion || deployForm.imageTag || packageForm.serviceVersion,
    servicePort: Number(deployForm.containerPort || packageForm.servicePort || 8080),
  }
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

  savedServers.value.sort(compareSavedServers)
}

/**
 * 按“默认服务器优先、更新时间倒序”排列左侧服务器列表。
 */
function compareSavedServers(left, right) {
  const leftPinned = left.id === pinnedServerId.value
  const rightPinned = right.id === pinnedServerId.value

  if (leftPinned !== rightPinned) {
    return leftPinned ? -1 : 1
  }

  return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
}

/**
 * 判断服务器是否满足启动自动连接条件。
 * - 密码模式：必须已经保存可回填密码。
 * - 私钥模式：必须有私钥路径；如果需要 passphrase，则用户仍需手动输入。
 */
function canAutoConnectServer(server) {
  if (server.authType === 'password') {
    return Boolean(server.password)
  }

  if (server.authType === 'privateKey') {
    return Boolean(server.privateKeyPath)
  }

  return false
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
 * 获取 preload 暴露的部署 API。
 */
function getDeploymentBridge() {
  return globalThis.window?.cendlink?.deployment ?? null
}

function getFrontendUploadBridge() {
  return globalThis.window?.cendlink?.frontendUpload ?? null
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

function normalizeCommandTimeoutSeconds(value) {
  const seconds = Number(value || DEFAULT_COMMAND_TIMEOUT_SECONDS)

  if (!Number.isFinite(seconds)) {
    return DEFAULT_COMMAND_TIMEOUT_SECONDS
  }

  return Math.min(
    Math.max(Math.round(seconds), MIN_COMMAND_TIMEOUT_SECONDS),
    MAX_COMMAND_TIMEOUT_SECONDS,
  )
}

function readTemplateMetadata(template) {
  if (!template) {
    return {}
  }

  if (template.metadata && Object.keys(template.metadata).length) {
    return template.metadata
  }

  if (template.templateText) {
    return parseDockerfileText(template.templateText)
  }

  return {}
}

function upsertSavedDockerfileTemplate(template) {
  const index = savedDockerfileTemplates.value.findIndex((item) => item.id === template.id)

  if (index >= 0) {
    savedDockerfileTemplates.value.splice(index, 1, template)
  } else {
    savedDockerfileTemplates.value.unshift(template)
  }

  savedDockerfileTemplates.value.sort((left, right) => {
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
  })
}

function upsertServiceTemplate(template) {
  const index = serviceTemplates.value.findIndex((item) => item.id === template.id)

  if (index >= 0) {
    serviceTemplates.value.splice(index, 1, template)
  } else {
    serviceTemplates.value.unshift(template)
  }

  serviceTemplates.value.sort((left, right) => {
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
  })
}

function upsertFrontendProject(project) {
  const index = frontendProjects.value.findIndex((item) => item.id === project.id)

  if (index >= 0) {
    frontendProjects.value.splice(index, 1, project)
  } else {
    frontendProjects.value.unshift(project)
  }

  frontendProjects.value.sort((left, right) => {
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
  })
}

/**
 * 生成带时间前缀的日志行。
 */
function logLine(message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })

  return `[${time}] ${message}`
}

function buildFrontendTargetDir(remoteBaseDir, projectDir) {
  const baseDir = String(remoteBaseDir || DEFAULT_FRONTEND_REMOTE_BASE_DIR)
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/g, '') || DEFAULT_FRONTEND_REMOTE_BASE_DIR
  const childDir = String(projectDir || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')

  return childDir ? `${baseDir}/${childDir}` : baseDir
}

/**
 * 根据文件路径推断部署默认值。
 */
function applyDeployPackageSelection(filePath) {
  const normalizedPath = String(filePath || '').trim()
  const fileName = normalizedPath.split(/[/\\]/).pop() || ''
  const sanitizedName = fileName
    .replace(/\.tar\.gz$/i, '')
    .replace(/\.tgz$/i, '')
    .replace(/\.tar$/i, '')
  const versionMatch = sanitizedName.match(/(?:-|_)(\d+(?:\.\d+)+(?:[-._][a-zA-Z0-9]+)?)$/)
  const inferredVersion = versionMatch ? versionMatch[1].replace(/_/g, '.') : deployForm.serviceVersion
  const inferredServiceName = sanitizedName
    .replace(new RegExp(`[-_]${escapeRegExp(versionMatch?.[1] || '')}$`), '')
    .replace(/_(\d{4})_(\d{2})_(\d{2})_/g, '')
    .replace(/_(\d{4})_(\d{2})_(\d{2})/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || deployForm.serviceName

  updateDeployForm({
    localPackagePath: normalizedPath,
    serviceName: inferredServiceName,
    serviceVersion: inferredVersion,
    imageName: inferredServiceName.toLowerCase(),
    imageTag: inferredVersion,
    containerName: inferredServiceName,
  })
}

/**
 * 从镜像包记录推断部署默认值。
 */
function inferDeployDefaultsFromDeployment(item) {
  const localPackagePath = item.deployPath || ''
  const metadata = item.metadata || {}
  const imageRef = String(metadata.imageRef || item.projectId || '')
  const [imageName = deployForm.imageName, imageTag = deployForm.imageTag] = imageRef.split(':')

  const normalizedServiceName = imageName.replace(/[^a-zA-Z0-9._-]+/g, '_') || deployForm.serviceName
  const containerPort = Number(metadata.servicePort || deployForm.containerPort || packageForm.servicePort || 8080)

  return {
    packageSourceType: 'history',
    localPackagePath,
    serviceName: metadata.serviceName || normalizedServiceName,
    serviceVersion: metadata.serviceVersion || imageTag || deployForm.serviceVersion,
    imageName: imageName || deployForm.imageName,
    imageTag: imageTag || deployForm.imageTag,
    containerName: normalizedServiceName,
    hostPort: Number(metadata.hostPort || containerPort || deployForm.hostPort || packageForm.servicePort || 8080),
    containerPort,
  }
}

/**
 * 将部署表单整理成主进程可执行的 payload。
 */
function toDeployPayload() {
  return {
    localPackagePath: deployForm.localPackagePath,
    serviceName: deployForm.serviceName,
    serviceVersion: deployForm.serviceVersion,
    imageName: deployForm.imageName,
    imageTag: deployForm.imageTag,
    containerName: deployForm.containerName,
    hostPort: Number(deployForm.hostPort || deployForm.containerPort || 0),
    containerPort: Number(deployForm.containerPort || 0),
    remoteBaseDir: deployForm.remoteBaseDir,
    remotePackageDir: deployForm.remotePackageDir,
    restartPolicy: deployForm.restartPolicy,
    envVars: parseEnvText(deployForm.envText),
    extraArgs: deployForm.extraArgs,
    containerConflictStrategy: deployForm.containerConflictStrategy,
    imageCleanupStrategy: deployForm.imageCleanupStrategy,
    directoryPermissionMode: deployForm.directoryPermissionMode,
  }
}

/**
 * 将多行 KEY=VALUE 文本解析为结构化环境变量。
 */
function parseEnvText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=')
      return {
        key: index >= 0 ? line.slice(0, index).trim() : line.trim(),
        value: index >= 0 ? line.slice(index + 1).trim() : '',
      }
    })
    .filter((item) => item.key)
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 对外暴露工作区会话。
 * 这是连接页、命令页、历史页和侧边栏共享状态的唯一入口。
 */
export function useWorkspaceSession() {
  return {
    form,
    packageForm,
    deployForm,
    frontendForm,
    packagePreview,
    packageResult,
    deployPreview,
    deployResult,
    frontendUploadPreview,
    frontendUploadResult,
    isBuildingPackage,
    isDeploying,
    isUploadingFrontend,
    result,
    commandResult,
    serverMetrics,
    isLoadingMetrics,
    metricsError,
    commandText,
    savedServers,
    commandRuns,
    deployments,
    savedDockerfileTemplates,
    serviceTemplates,
    frontendProjects,
    workspaceSettings,
    dockerfileTemplateOptions,
    selectedDockerfileTemplate,
    selectedServiceTemplate,
    selectedServiceTemplateId,
    selectedFrontendProject,
    selectedFrontendProjectId,
    activeServerId,
    pinnedServerId,
    storageInfo,
    isTesting,
    isExecutingCommand,
    isLoadingStoredData,
    isSavingServer,
    isSavingDockerfileTemplate,
    isSavingServiceTemplate,
    isSavingFrontendProject,
    isSavingSettings,
    deletingDeploymentIds,
    settingsResult,
    logs,
    hasElectronBridge,
    hasStorageBridge,
    hasDeploymentBridge,
    hasFrontendUploadBridge,
    hasDockerfileTemplateBridge,
    hasServiceTemplateBridge,
    hasFrontendProjectBridge,
    isCreatingServer,
    needsRetest,
    canExecuteCommand,
    canBuildImagePackage,
    canDeploy,
    canUploadFrontend,
    commandHint,
    packageHint,
    deployHint,
    frontendUploadHint,
    loadStoredData,
    loadDockerfileTemplates,
    loadServiceTemplates,
    loadFrontendProjects,
    selectJarFile,
    selectDeployPackageFile,
    selectFrontendArchiveFile,
    refreshPackagePreview,
    refreshDeployPreview,
    refreshFrontendUploadPreview,
    buildImagePackage,
    runDeployment,
    runFrontendUpload,
    openImagePackageDirectory,
    recordImagePackage,
    recordRemoteDeployment,
    recordFrontendUpload,
    deleteDeploymentRecord,
    saveCurrentServer,
    selectDockerfileTemplate,
    selectServiceTemplate,
    applyImportedDockerfileTemplate,
    saveDockerfileTemplate,
    deleteDockerfileTemplate,
    saveServiceTemplateFromPackage,
    saveServiceTemplateFromDeploy,
    deleteServiceTemplate,
    selectFrontendProject,
    saveFrontendProjectFromForm,
    deleteFrontendProject,
    createNewServer,
    pinServer,
    selectSavedServer,
    updateForm,
    updateCommandText,
    updatePackageForm,
    updateDeployForm,
    updateFrontendForm,
    updateWorkspaceSettings,
    saveWorkspaceSettings,
    testConnection,
    executeCommand,
    refreshServerMetrics,
    selectPrivateKeyFile,
    clearLogs,
  }
}
