<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'
import { parseNginxConfig } from '../utils/nginxConfigParser.js'

const MAX_PATH_TYPE_CHECKS = 32
const MAX_CONFIG_FILES = 16
const GENERIC_SERVICE_KEYS = new Set([
  'admin',
  'api',
  'assets',
  'backend',
  'default',
  'file',
  'files',
  'frontend',
  'html',
  'index',
  'oss',
  'root',
  'server',
  'service',
  'static',
  'upload',
  'uploads',
  'user',
  'web',
  'www',
])
const SERVICE_KEY_ALIASES = new Map([
  ['aibox-admin', 'aibox'],
  ['aibox-api', 'aibox'],
  ['aibox-backend', 'aibox'],
  ['aibox-user', 'aibox'],
  ['baicao-api', 'baicao'],
  ['data-sync-center', 'data-sync-center'],
  ['datasynccenter', 'data-sync-center'],
  ['data_sync_center', 'data-sync-center'],
  ['huashidai1', 'huashidai'],
  ['minio-console', 'minio'],
  ['minio-api', 'minio'],
  ['music-api', 'music'],
])
const KNOWN_SERVICE_HINTS = [
  { key: 'aibox', tests: ['aibox', 'ai工作盒子', 'AI工作盒子', '工作盒子'] },
  { key: 'baicao', tests: ['baicao', '百草'] },
  { key: 'data-sync-center', tests: ['datasynccenter', 'data_sync_center', 'data-sync-center', '数据中心平台'] },
  { key: 'music', tests: ['music', '音乐'] },
  { key: 'minio', tests: ['minio'] },
  { key: 'huashidai', tests: ['huashidai', 'huashidai1', '华时代', '主站'] },
]

const route = useRoute()
const router = useRouter()

const {
  form,
  result,
  needsRetest,
  hasElectronBridge,
  workspaceSettings,
} = useWorkspaceSession()

const inspectData = ref(null)
const mountRows = ref([])
const configFiles = ref([])
const selectedConfigId = ref('')
const detailServiceId = ref('')
const isLoading = ref(false)
const loadError = ref('')
const configLoadError = ref('')

const routeContainerId = computed(() => String(route.params.containerId || '').trim())

const canQueryDocker = computed(() => {
  return Boolean(hasElectronBridge.value && result.value?.ok && !needsRetest.value)
})

const connectionHint = computed(() => {
  if (!hasElectronBridge.value) {
    return '请通过 Electron 模式启动应用后再读取 Nginx 配置。'
  }

  if (!result.value?.ok) {
    return '请先在服务器页完成连接测试。'
  }

  if (needsRetest.value) {
    return '服务器连接信息已变更，请重新测试连接。'
  }

  return ''
})

const containerSummary = computed(() => {
  const inspect = inspectData.value
  const state = inspect?.State || {}

  return {
    id: inspect?.Id || routeContainerId.value,
    shortId: String(inspect?.Id || routeContainerId.value || '').slice(0, 12),
    name: stripContainerName(inspect?.Name) || route.query.name || 'Nginx 容器',
    status: formatContainerState(state) || route.query.status || '-',
  }
})

const configMountRows = computed(() => mountRows.value.filter((item) => item.group === 'config'))
const frontendMountRows = computed(() => mountRows.value.filter((item) => item.group === 'static'))
const otherMountRows = computed(() => mountRows.value.filter((item) => !item.isNginxRelated))
const groupedMountSections = computed(() => [
  {
    key: 'frontend',
    title: '前端站点挂载',
    eyebrow: 'Frontend',
    description: '静态资源目录，通常对应站点构建产物或发布目录。',
    rows: frontendMountRows.value,
    emptyText: '未检测到静态站点目录',
  },
  {
    key: 'backend',
    title: '后端配置挂载',
    eyebrow: 'Nginx',
    description: 'Nginx 主配置、conf.d 目录和站点规则文件。',
    rows: configMountRows.value,
    emptyText: '未检测到配置目录或配置文件',
  },
  {
    key: 'other',
    title: '其他挂载',
    eyebrow: 'Other',
    description: '暂未归类为 Nginx 配置或前端站点的容器挂载。',
    rows: otherMountRows.value,
    emptyText: '没有其他挂载',
  },
])
const selectedConfigFile = computed(() => {
  return configFiles.value.find((file) => file.id === selectedConfigId.value) || configFiles.value[0] || null
})
const selectedConfigAnalysis = computed(() => selectedConfigFile.value?.analysis || null)
const serviceCards = computed(() => buildServiceCards(selectedConfigAnalysis.value?.servers || []))
const systemRules = computed(() => buildSystemRules(selectedConfigAnalysis.value?.servers || []))
const selectedRouteOverview = computed(() => {
  return serviceCards.value.reduce(
    (summary, service) => ({
      services: summary.services + 1,
      frontend: summary.frontend + service.frontend.length,
      backend: summary.backend + service.backend.length,
      system: systemRules.value.length,
    }),
    {
      services: 0,
      frontend: 0,
      backend: 0,
      system: systemRules.value.length,
    },
  )
})
const detailService = computed(() => {
  return serviceCards.value.find((service) => service.id === detailServiceId.value) || null
})

const mountOverview = computed(() => {
  return {
    all: mountRows.value.length,
    nginx: configMountRows.value.length + frontendMountRows.value.length,
    config: configMountRows.value.length,
    static: frontendMountRows.value.length,
    other: otherMountRows.value.length,
  }
})

onMounted(() => {
  void loadNginxConfigInfo()
  window.addEventListener('keydown', handleDetailKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleDetailKeydown)
})

watch(routeContainerId, () => {
  void loadNginxConfigInfo()
})

watch(canQueryDocker, (ready) => {
  if (ready && !inspectData.value && !isLoading.value) {
    void loadNginxConfigInfo()
  }
})

watch(selectedConfigId, () => {
  detailServiceId.value = ''
})

watch(serviceCards, (cards) => {
  if (detailServiceId.value && !cards.some((service) => service.id === detailServiceId.value)) {
    detailServiceId.value = ''
  }
})

async function loadNginxConfigInfo() {
  if (!routeContainerId.value) {
    loadError.value = '缺少容器 ID，无法读取 Nginx 配置。'
    return
  }

  if (!canQueryDocker.value) {
    loadError.value = connectionHint.value
    return
  }

  isLoading.value = true
  loadError.value = ''
  configLoadError.value = ''
  inspectData.value = null
  mountRows.value = []
  configFiles.value = []
  selectedConfigId.value = ''

  try {
    const response = await executeRemoteCommand(`docker inspect ${shellQuote(routeContainerId.value)}`)

    if (!response.ok) {
      throw new Error(response.message || mergeCommandOutput(response) || '读取 docker inspect 失败')
    }

    const inspect = parseDockerInspect(response.stdout)
    inspectData.value = inspect

    const normalizedMounts = normalizeMountRows(inspect)
    mountRows.value = normalizedMounts

    if (normalizedMounts.length) {
      await hydratePathTypes(normalizedMounts, inspect)
    }

    await loadConfigFilesFromMounts(mountRows.value, inspect)
  } catch (error) {
    loadError.value = error?.message || String(error)
  } finally {
    isLoading.value = false
  }
}

async function hydratePathTypes(rows, inspect) {
  const hostPaths = uniqueValues(rows.map((item) => item.source).filter(Boolean)).slice(0, MAX_PATH_TYPE_CHECKS)
  const containerPaths = uniqueValues(rows.map((item) => item.destination).filter(Boolean)).slice(0, MAX_PATH_TYPE_CHECKS)
  const hostTypes = {}
  const containerTypes = {}

  if (hostPaths.length) {
    try {
      const response = await executeRemoteCommand(buildPathTypeProbeCommand(hostPaths))

      if (response.ok) {
        Object.assign(hostTypes, parsePathTypeOutput(response.stdout))
      }
    } catch {
      // 路径类型只是辅助信息，失败时保留主挂载结果。
    }
  }

  if (containerPaths.length && inspect?.State?.Running) {
    try {
      const response = await executeRemoteCommand(
        `docker exec ${shellQuote(routeContainerId.value)} sh -c ${shellQuote(buildPathTypeProbeCommand(containerPaths))}`,
      )

      if (response.ok) {
        Object.assign(containerTypes, parsePathTypeOutput(response.stdout))
      }
    } catch {
      // 容器内检测失败不阻断页面展示。
    }
  }

  mountRows.value = rows.map((item) => ({
    ...item,
    sourceType: hostTypes[item.source] || 'unknown',
    destinationType: containerTypes[item.destination] || (inspect?.State?.Running ? 'unknown' : 'skipped'),
  }))
}

async function loadConfigFilesFromMounts(rows, inspect) {
  const candidates = await resolveConfigFileCandidates(rows, inspect)

  if (!candidates.length) {
    configLoadError.value = '已完成挂载检测，但还没有找到可读取的 .conf 配置文件。'
    return
  }

  const loadedFiles = []

  for (const candidate of candidates.slice(0, MAX_CONFIG_FILES)) {
    try {
      const response = await executeRemoteCommand(buildReadConfigCommand(candidate))

      if (!response.ok) {
        continue
      }

      const content = response.stdout || ''

      loadedFiles.push({
        ...candidate,
        content,
        analysis: parseNginxConfig(content, {
          name: candidate.name,
          path: candidate.containerPath || candidate.hostPath,
        }),
      })
    } catch {
      // 某个配置文件读取失败时继续读取其他文件，页面会用已成功读取的文件渲染。
    }
  }

  configFiles.value = loadedFiles
  selectedConfigId.value = pickDefaultConfigFile(loadedFiles)?.id || ''

  if (!loadedFiles.length) {
    configLoadError.value = '检测到了配置路径，但读取配置文件失败，请确认宿主机路径权限。'
  }
}

async function resolveConfigFileCandidates(rows, inspect) {
  const directFiles = []
  const configDirs = []
  const mappedRows = rows.filter((row) => row.isNginxRelated && row.group === 'config')

  mappedRows.forEach((row) => {
    if (!row.source || !row.destination) {
      return
    }

    const destination = normalizeLinuxPath(row.destination)

    if (destination.endsWith('.conf') || destination.endsWith('/nginx.conf')) {
      directFiles.push(createConfigCandidate(row.source, destination, row))
      return
    }

    if (
      destination === '/etc/nginx' ||
      destination === '/etc/nginx/conf.d' ||
      destination.startsWith('/etc/nginx/')
    ) {
      configDirs.push(row)
    }
  })

  const directoryFiles = []

  for (const row of configDirs) {
    const response = await executeRemoteCommand(buildFindConfigFilesCommand(row.source))

    if (!response.ok) {
      continue
    }

    parseCommandLines(response.stdout).forEach((hostPath) => {
      const relativePath = relativeLinuxPath(row.source, hostPath)
      const containerPath = joinLinuxPath(row.destination, relativePath)

      directoryFiles.push(createConfigCandidate(hostPath, containerPath, row))
    })
  }

  const mountedCandidates = dedupeConfigCandidates([...directFiles, ...directoryFiles])

  if (mountedCandidates.length || !inspect?.State?.Running) {
    return sortConfigCandidates(mountedCandidates)
  }

  const containerCandidates = await resolveContainerConfigCandidates(inspect)

  return sortConfigCandidates(containerCandidates)
}

async function resolveContainerConfigCandidates(inspect) {
  const response = await executeRemoteCommand(
    `docker exec ${shellQuote(routeContainerId.value)} sh -c ${shellQuote(
      "find /etc/nginx -maxdepth 2 -type f \\( -name 'nginx.conf' -o -name '*.conf' \\) -print 2>/dev/null | sort",
    )}`,
  )

  if (!response.ok) {
    return []
  }

  return parseCommandLines(response.stdout).map((containerPath) => ({
    id: `container:${containerPath}`,
    name: fileNameFromPath(containerPath),
    hostPath: '',
    containerPath,
    source: 'container',
    role: configFileRole(containerPath),
    priority: configFilePriority(containerPath),
    readMode: 'container',
    writable: false,
    containerRunning: Boolean(inspect?.State?.Running),
  }))
}

function createConfigCandidate(hostPath, containerPath, row) {
  const normalizedHostPath = normalizeLinuxPath(hostPath)
  const normalizedContainerPath = normalizeLinuxPath(containerPath)

  return {
    id: `${normalizedHostPath || normalizedContainerPath}`,
    name: fileNameFromPath(normalizedContainerPath || normalizedHostPath),
    hostPath: normalizedHostPath,
    containerPath: normalizedContainerPath,
    source: row.type || 'bind',
    role: configFileRole(normalizedContainerPath || normalizedHostPath),
    priority: configFilePriority(normalizedContainerPath || normalizedHostPath),
    readMode: normalizedHostPath ? 'host' : 'container',
    writable: row.rw !== '只读' && row.type === 'bind',
    containerRunning: false,
  }
}

function buildFindConfigFilesCommand(hostDir) {
  const quotedDir = shellQuote(hostDir)

  return [
    `if [ -d ${quotedDir} ]; then`,
    `find ${quotedDir} -maxdepth 2 -type f \\( -name 'nginx.conf' -o -name '*.conf' \\) -print 2>/dev/null | sort;`,
    'fi',
  ].join(' ')
}

function buildReadConfigCommand(candidate) {
  if (candidate.readMode === 'container') {
    return `docker exec ${shellQuote(routeContainerId.value)} cat ${shellQuote(candidate.containerPath)}`
  }

  return `cat ${shellQuote(candidate.hostPath)}`
}

function dedupeConfigCandidates(candidates) {
  const seen = new Set()

  return candidates.filter((candidate) => {
    const key = candidate.containerPath || candidate.hostPath

    if (!key || seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function sortConfigCandidates(candidates) {
  return [...candidates].sort((left, right) => (
    left.priority - right.priority ||
    left.containerPath.localeCompare(right.containerPath)
  ))
}

function pickDefaultConfigFile(files) {
  return files.find((file) => file.containerPath.endsWith('/conf.d/default.conf')) ||
    files.find((file) => file.containerPath.includes('/conf.d/')) ||
    files.find((file) => file.containerPath.endsWith('/nginx.conf')) ||
    files[0] ||
    null
}

async function executeRemoteCommand(command) {
  const ssh = getSshBridge()

  if (!ssh?.executeCommand) {
    throw new Error('当前是浏览器预览模式，无法执行远程 Docker 命令')
  }

  return ssh.executeCommand(
    {
      ...form,
      commandTimeoutMs: normalizeTimeoutSeconds(workspaceSettings.commandTimeoutSeconds) * 1000,
    },
    command,
  )
}

function parseDockerInspect(output) {
  const parsed = JSON.parse(String(output || '[]'))
  const inspect = Array.isArray(parsed) ? parsed[0] : parsed

  if (!inspect || typeof inspect !== 'object') {
    throw new Error('docker inspect 未返回有效容器信息')
  }

  return inspect
}

function normalizeMountRows(inspect) {
  return (Array.isArray(inspect?.Mounts) ? inspect.Mounts : [])
    .map((mount, index) => {
      const destination = normalizeLinuxPath(mount.Destination || mount.Target || '')
      const classification = classifyNginxMount(destination)

      return {
        id: `${index}-${destination || mount.Source || mount.Name || 'mount'}`,
        source: String(mount.Source || '').trim(),
        destination,
        mode: String(mount.Mode || '').trim() || '-',
        rw: mount.RW === false ? '只读' : '可写',
        type: String(mount.Type || '').trim() || 'unknown',
        propagation: String(mount.Propagation || '').trim() || '-',
        name: String(mount.Name || '').trim(),
        sourceType: 'unknown',
        destinationType: 'unknown',
        ...classification,
      }
    })
    .filter((item) => item.source || item.destination)
    .sort((left, right) => left.priority - right.priority || left.destination.localeCompare(right.destination))
}

function classifyNginxMount(destination) {
  if (destination === '/etc/nginx/nginx.conf') {
    return {
      role: '主配置文件',
      group: 'config',
      isNginxRelated: true,
      priority: 0,
    }
  }

  if (destination === '/etc/nginx/conf.d' || destination.startsWith('/etc/nginx/conf.d/')) {
    return {
      role: '站点配置目录',
      group: 'config',
      isNginxRelated: true,
      priority: 1,
    }
  }

  if (destination === '/etc/nginx' || destination.startsWith('/etc/nginx/')) {
    return {
      role: 'Nginx 配置路径',
      group: 'config',
      isNginxRelated: true,
      priority: 2,
    }
  }

  if (destination === '/usr/share/nginx/html' || destination.startsWith('/usr/share/nginx/html/')) {
    return {
      role: '静态站点目录',
      group: 'static',
      isNginxRelated: true,
      priority: 3,
    }
  }

  return {
    role: '其他挂载',
    group: 'other',
    isNginxRelated: false,
    priority: 50,
  }
}

function buildPathTypeProbeCommand(paths) {
  return paths
    .map((path) => {
      const quotedPath = shellQuote(path)

      return [
        `printf '%s|||%s\\n' ${quotedPath} "$(`,
        `if [ -f ${quotedPath} ]; then printf file; `,
        `elif [ -d ${quotedPath} ]; then printf directory; `,
        `elif [ -e ${quotedPath} ]; then printf other; `,
        'else printf missing; fi',
        ')"',
      ].join('')
    })
    .join('\n')
}

function parsePathTypeOutput(output) {
  return String(output || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((resultMap, line) => {
      const separatorIndex = line.lastIndexOf('|||')

      if (separatorIndex <= 0) {
        return resultMap
      }

      const path = line.slice(0, separatorIndex)
      const type = line.slice(separatorIndex + 3)

      resultMap[path] = type || 'unknown'
      return resultMap
    }, {})
}

function formatContainerState(state) {
  if (!state || typeof state !== 'object') {
    return ''
  }

  if (state.Running) {
    return '运行中'
  }

  if (state.Status) {
    return state.Status
  }

  return ''
}

function isSummaryRunning(status) {
  const normalized = String(status || '').trim().toLowerCase()

  return normalized === '运行中' || normalized === 'running' || normalized.startsWith('up')
}

function normalizeLinuxPath(value) {
  const normalized = String(value || '').trim()

  if (!normalized) {
    return ''
  }

  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

function stripContainerName(value) {
  return String(value || '').replace(/^\//, '')
}

function uniqueValues(values) {
  return Array.from(new Set(values))
}

function mergeCommandOutput(response) {
  return [response.stdout, response.stderr]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n')
}

function mountTypeLabel(type) {
  const normalized = String(type || '').toLowerCase()

  if (normalized === 'bind') {
    return '绑定挂载'
  }

  if (normalized === 'volume') {
    return 'Docker 卷'
  }

  if (normalized === 'tmpfs') {
    return '临时挂载'
  }

  return type || '未知挂载'
}

function pathTypeLabel(type) {
  const normalized = String(type || '').toLowerCase()

  if (normalized === 'file') {
    return '文件'
  }

  if (normalized === 'directory') {
    return '目录'
  }

  if (normalized === 'missing') {
    return '不存在'
  }

  if (normalized === 'other') {
    return '其他'
  }

  if (normalized === 'skipped') {
    return '未检测'
  }

  return '未识别'
}

function editabilityLabel(row) {
  if (row.type === 'bind' && (row.sourceType === 'file' || row.sourceType === 'directory')) {
    return '可从宿主机编辑'
  }

  if (row.type === 'volume') {
    return 'Docker 卷路径'
  }

  if (row.sourceType === 'missing') {
    return '宿主机路径不存在'
  }

  return '需确认路径'
}

function mountCardState(row) {
  if (row.sourceType === 'missing') {
    return 'missing'
  }

  if (row.rw === '只读') {
    return 'readonly'
  }

  if (row.type === 'bind' && (row.sourceType === 'file' || row.sourceType === 'directory')) {
    return 'editable'
  }

  return 'neutral'
}

function mountCardStateLabel(row) {
  const state = mountCardState(row)

  if (state === 'missing') {
    return '缺失'
  }

  if (state === 'readonly') {
    return '只读'
  }

  if (state === 'editable') {
    return '可编辑'
  }

  return row.rw || '未知'
}

function mountGroupLabel(row) {
  if (row.group === 'static') {
    return '前端'
  }

  if (row.group === 'config') {
    return '后端配置'
  }

  return '其他'
}

function parseCommandLines(output) {
  return String(output || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== '[output truncated]')
}

function relativeLinuxPath(basePath, filePath) {
  const base = normalizeLinuxPath(basePath)
  const file = normalizeLinuxPath(filePath)

  if (!base || !file || !file.startsWith(`${base}/`)) {
    return fileNameFromPath(file)
  }

  return file.slice(base.length + 1)
}

function joinLinuxPath(basePath, relativePath) {
  const base = normalizeLinuxPath(basePath)
  const relative = String(relativePath || '').replace(/^\/+/, '')

  if (!relative) {
    return base
  }

  return `${base}/${relative}`.replace(/\/+/g, '/')
}

function fileNameFromPath(filePath) {
  return String(filePath || '').split('/').filter(Boolean).pop() || 'nginx.conf'
}

function configFileRole(filePath) {
  const normalized = normalizeLinuxPath(filePath)

  if (normalized.endsWith('/conf.d/default.conf')) {
    return '默认站点配置'
  }

  if (normalized.includes('/conf.d/')) {
    return '站点配置'
  }

  if (normalized.endsWith('/nginx.conf')) {
    return '主配置'
  }

  return '配置文件'
}

function configFilePriority(filePath) {
  const normalized = normalizeLinuxPath(filePath)

  if (normalized.endsWith('/conf.d/default.conf')) {
    return 0
  }

  if (normalized.includes('/conf.d/')) {
    return 1
  }

  if (normalized.endsWith('/nginx.conf')) {
    return 2
  }

  return 5
}

function buildServiceCards(servers) {
  const serviceMap = new Map()

  servers.forEach((server) => {
    const routes = [
      ...frontendLocations(server).map((location) => ({ location, type: 'frontend' })),
      ...backendLocations(server).map((location) => ({ location, type: 'backend' })),
    ]

    routes.forEach(({ location, type }) => {
      const identity = inferServiceIdentity(location, server)
      const service = ensureServiceCard(serviceMap, identity.key)

      registerServiceSource(service, location, server, identity)
      service[type].push(createRouteRecord(location, server, type, identity))
    })
  })

  return Array.from(serviceMap.values())
    .map(finalizeServiceCard)
    .sort((left, right) => {
      const leftScore = (left.frontend.length ? 0 : 2) + (left.backend.length ? 0 : 1)
      const rightScore = (right.frontend.length ? 0 : 2) + (right.backend.length ? 0 : 1)

      return leftScore - rightScore || left.name.localeCompare(right.name, 'zh-Hans-CN')
    })
}

function buildSystemRules(servers) {
  return servers.flatMap((server) => {
    const serverReturns = server.returns.map((returnRule, index) => ({
      id: `${server.id}:return:${index}`,
      title: 'Server 跳转',
      scope: server.serverNames.length ? server.serverNames.join(' / ') : server.title,
      detail: returnRule,
      tone: 'redirect',
    }))

    const otherRules = otherLocations(server).map((location) => ({
      id: `${server.id}:location:${location.id}`,
      title: location.kind === 'redirect' ? '路径跳转' : '其他规则',
      scope: routePathLabel(location),
      detail: otherRuleLabel(location),
      tone: location.kind === 'redirect' ? 'redirect' : 'neutral',
    }))

    return [...serverReturns, ...otherRules]
  })
}

function ensureServiceCard(serviceMap, key) {
  if (!serviceMap.has(key)) {
    serviceMap.set(key, {
      id: key,
      key,
      name: formatServiceName(key),
      alias: key,
      frontend: [],
      backend: [],
      titleCandidates: [],
      serverNames: new Set(),
      listens: new Set(),
      serverTitles: new Set(),
      matchReasons: new Set(),
      hasHttps: false,
    })
  }

  return serviceMap.get(key)
}

function registerServiceSource(service, location, server, identity) {
  const titleName = extractServiceNameFromTitle(location.title, service.key)

  if (titleName) {
    service.titleCandidates.push(titleName)
  }

  if (identity?.reason) {
    service.matchReasons.add(identity.reason)
  }

  server.serverNames.forEach((name) => service.serverNames.add(name))
  server.listens.forEach((listen) => service.listens.add(listen))

  if (server.title) {
    service.serverTitles.add(server.title)
  }

  service.hasHttps = service.hasHttps || Boolean(server.flags?.https)
}

function finalizeServiceCard(service) {
  const frontend = sortRouteRecords(service.frontend)
  const backend = sortRouteRecords(service.backend)
  const serverNames = Array.from(service.serverNames).filter(Boolean)
  const listens = Array.from(service.listens).filter(Boolean)
  const serverTitles = Array.from(service.serverTitles).filter(Boolean)
  const matchReasons = Array.from(service.matchReasons).filter(Boolean)
  const candidateName = service.titleCandidates.find(Boolean)
  const name = candidateName || service.name

  return {
    ...service,
    name,
    frontend,
    backend,
    serverNames,
    listens,
    serverTitles,
    matchReasons,
    matchLabel: compactList(matchReasons, '按路径与项目标识自动归类'),
    domainLabel: compactList(serverNames, '未设置 server_name'),
    listenLabel: compactList(listens, '未声明 listen'),
    statusLabel: serviceStatusLabel(frontend, backend),
    statusTone: serviceStatusTone(frontend, backend),
    hasPair: frontend.length > 0 && backend.length > 0,
  }
}

function createRouteRecord(location, server, type, identity) {
  const isFrontend = type === 'frontend'

  return {
    id: `${server.id}:${location.id}`,
    path: routePathLabel(location),
    title: location.title !== location.path ? location.title : '',
    kind: location.kind,
    kindLabel: isFrontend
      ? (location.kind === 'spa' ? '前端路由' : '静态资源')
      : backendKindLabel(location),
    targetLabel: isFrontend ? frontendTargetLabel(location) : backendTargetLabel(location),
    fallbackLabel: isFrontend ? frontendFallbackLabel(location) : '',
    serverTitle: server.title,
    serverLine: server.line,
    serverNames: server.serverNames,
    listenLabel: serverListenLabel(server),
    sourceLabel: `${server.title} · line ${server.line}`,
    matchReason: identity?.reason || '',
    https: Boolean(server.flags?.https),
  }
}

function sortRouteRecords(routes) {
  return [...routes].sort((left, right) => left.path.localeCompare(right.path, 'zh-Hans-CN'))
}

function inferServiceIdentity(location, server) {
  const titleKey = extractKeyFromTitle(location.title)

  if (titleKey) {
    return {
      key: titleKey,
      reason: `注释标识 ${titleKey}`,
    }
  }

  const titleHint = inferKnownServiceFromText(location.title)

  if (titleHint) {
    return {
      key: titleHint,
      reason: `注释名称 ${formatServiceName(titleHint)}`,
    }
  }

  const pathSegment = firstServicePathSegment(location)

  if (pathSegment) {
    const key = normalizeServiceKey(pathSegment)

    if (key && !isGenericServiceKey(key)) {
      return {
        key,
        reason: `路径前缀 /${pathSegment}`,
      }
    }
  }

  const targetKey = inferServiceKeyFromTarget(location)

  if (targetKey) {
    return {
      key: targetKey,
      reason: `目标地址 ${targetKey}`,
    }
  }

  const serverKey = inferServiceKeyFromServerName(server.serverNames)

  if (serverKey) {
    return {
      key: serverKey,
      reason: `域名 ${serverKey}`,
    }
  }

  return {
    key: `server-${server.id}`,
    reason: '未命名 server',
  }
}

function extractKeyFromTitle(title) {
  const match = String(title || '').match(/[（(]\s*([^）)]+)\s*[）)]/)
  const rawCandidate = match?.[1] || ''
  const knownKey = inferKnownServiceFromText(rawCandidate)
  const candidate = rawCandidate ? (knownKey || normalizeServiceKey(rawCandidate)) : ''

  if (!candidate || /^\d+$/.test(candidate) || isGenericServiceKey(candidate)) {
    return ''
  }

  return candidate
}

function inferKnownServiceFromText(text) {
  const normalized = normalizeServiceLookupText(text)

  if (!normalized) {
    return ''
  }

  const match = KNOWN_SERVICE_HINTS.find((item) => (
    item.tests.some((test) => normalized.includes(normalizeServiceLookupText(test)))
  ))

  return match?.key || ''
}

function extractServiceNameFromTitle(title, key) {
  const text = String(title || '').replace(/\s+/g, ' ').trim()
  const match = text.match(/^(.+?)\s*[（(]\s*([^）)]+)\s*[）)]/)

  if (!match || normalizeServiceKey(match[2]) !== key) {
    return ''
  }

  const name = match[1].trim()
  const genericNames = new Set(['接口转发', '接口代理', '前端路由', '静态资源', '后端接口'])

  return genericNames.has(name) ? '' : name
}

function firstServicePathSegment(location) {
  const candidates = [
    location.path,
    routePathLabel(location),
  ]

  for (const candidate of candidates) {
    const segment = firstPathSegment(candidate)

    if (segment) {
      return segment
    }
  }

  return ''
}

function firstPathSegment(value) {
  const text = String(value || '')
    .trim()
    .replace(/^location\s+/i, '')
    .replace(/^(=|\^~|~\*?|@)\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/^https?:\/\/[^/]+/i, '')
  const match = text.match(/\/+([^/\s?()[\]{}^$*+|]+)/)

  return match?.[1] || ''
}

function inferServiceKeyFromTarget(location) {
  const target = location.proxyPass || location.root || location.alias || ''
  const knownKey = inferKnownServiceFromText(target)

  if (knownKey) {
    return knownKey
  }

  return ''
}

function inferServiceKeyFromServerName(serverNames = []) {
  for (const name of serverNames) {
    const text = String(name || '').trim()

    if (!text || text === '_') {
      continue
    }

    const knownKey = inferKnownServiceFromText(text)

    if (knownKey) {
      return knownKey
    }

    const [firstLabel = ''] = text.replace(/^www\./i, '').split('.')
    const key = normalizeServiceKey(firstLabel)

    if (key && !isGenericServiceKey(key)) {
      return key
    }
  }

  return ''
}

function normalizeServiceKey(value) {
  const raw = normalizeServiceToken(value)

  if (!raw) {
    return 'service'
  }

  const aliased = SERVICE_KEY_ALIASES.get(raw) || raw
  const stripped = aliased.replace(/[-_](api|backend|server|service|proxy|admin|user|console)$/i, '')

  return SERVICE_KEY_ALIASES.get(stripped) || stripped || aliased
}

function normalizeServiceToken(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^www\./i, '')
    .replace(/[:?#].*$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function normalizeServiceLookupText(value) {
  return normalizeServiceToken(value).replace(/-/g, '')
}

function isGenericServiceKey(key) {
  return GENERIC_SERVICE_KEYS.has(String(key || '').toLowerCase())
}

function formatServiceName(key) {
  const knownNames = {
    aibox: 'AI 工作盒子',
    baicao: '百草项目',
    'data-sync-center': 'Data Sync Center',
    huashidai: '华时代主站',
    minio: 'MinIO',
  }

  if (knownNames[key]) {
    return knownNames[key]
  }

  if (/[\u4e00-\u9fa5]/.test(key)) {
    return key
  }

  return key
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function compactList(values, emptyText) {
  const list = values.filter(Boolean)

  if (!list.length) {
    return emptyText
  }

  if (list.length <= 2) {
    return list.join(' / ')
  }

  return `${list.slice(0, 2).join(' / ')} 等 ${list.length} 项`
}

function serviceStatusLabel(frontend, backend) {
  if (frontend.length && backend.length) {
    return '前后端已对应'
  }

  if (frontend.length) {
    return '仅前端入口'
  }

  if (backend.length) {
    return '仅后端接口'
  }

  return '未识别路由'
}

function serviceStatusTone(frontend, backend) {
  if (frontend.length && backend.length) {
    return 'paired'
  }

  if (frontend.length) {
    return 'frontend'
  }

  if (backend.length) {
    return 'backend'
  }

  return 'neutral'
}

function routePreview(routes, emptyText) {
  return routes.length ? routes.slice(0, 3) : [{ id: emptyText, path: emptyText, muted: true }]
}

function frontendLocations(server) {
  return (server.locations || []).filter((location) => location.kind === 'spa' || location.kind === 'static')
}

function backendLocations(server) {
  return (server.locations || []).filter((location) => location.kind === 'proxy' || location.kind === 'websocket')
}

function otherLocations(server) {
  return (server.locations || []).filter((location) => (
    location.kind !== 'spa' &&
    location.kind !== 'static' &&
    location.kind !== 'proxy' &&
    location.kind !== 'websocket'
  ))
}

function routePathLabel(location) {
  return location.matcher ? `${location.matcher} ${location.path}` : location.path || '-'
}

function frontendTargetLabel(location) {
  if (location.alias) {
    return location.alias
  }

  if (location.root) {
    return location.root
  }

  return '-'
}

function frontendFallbackLabel(location) {
  return location.tryFiles.length ? location.tryFiles.join(' ') : '直接返回静态资源'
}

function backendTargetLabel(location) {
  return location.proxyPass || '-'
}

function backendKindLabel(location) {
  return location.kind === 'websocket' ? 'WebSocket' : '接口代理'
}

function otherRuleLabel(location) {
  if (location.returns.length) {
    return `return ${location.returns.join(' ')}`
  }

  return location.kind === 'redirect' ? '跳转规则' : '自定义规则'
}

function serverListenLabel(server) {
  return server.listens.length ? server.listens.join(' / ') : '未声明 listen'
}

function normalizeTimeoutSeconds(value) {
  const seconds = Number(value || 60)

  if (!Number.isFinite(seconds)) {
    return 60
  }

  return Math.min(Math.max(Math.round(seconds), 5), 600)
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`
}

function getSshBridge() {
  return globalThis.window?.cendlink?.ssh ?? null
}

function openServiceDetail(service) {
  detailServiceId.value = service.id
}

function closeServiceDetail() {
  detailServiceId.value = ''
}

function handleDetailKeydown(event) {
  if (event.key === 'Escape' && detailServiceId.value) {
    closeServiceDetail()
  }
}

function backToContainers() {
  router.push({ name: 'containers' })
}
</script>

<template>
  <div class="nginx-config-view">
    <section class="nginx-config-main">
      <div class="nginx-config-body">
        <section class="nginx-workbar" :class="{ 'no-files': !configFiles.length }">
          <div class="nginx-workbar-context">
            <button
              class="nginx-back-button"
              type="button"
              aria-label="返回容器列表"
              title="返回容器列表"
              @click="backToContainers"
            >
              ←
            </button>
          <div class="nginx-container-heading">
            <span
              class="container-status-dot"
              :class="{ running: isSummaryRunning(containerSummary.status), neutral: !isSummaryRunning(containerSummary.status) }"
            ></span>
            <div>
              <h2 :title="containerSummary.name">{{ containerSummary.name }}</h2>
              <small>{{ containerSummary.shortId || '-' }} · {{ containerSummary.status }}</small>
            </div>
          </div>
          </div>

          <div v-if="configFiles.length" class="nginx-file-tabs" role="tablist" aria-label="Nginx 配置文件">
            <button
              v-for="file in configFiles"
              :key="file.id"
              class="nginx-config-tab"
              :class="{ selected: selectedConfigFile?.id === file.id }"
              type="button"
              role="tab"
              :aria-selected="selectedConfigFile?.id === file.id"
              @click="selectedConfigId = file.id"
            >
              <strong>{{ file.name }}</strong>
              <small>{{ file.role }} · {{ file.writable ? '可写' : '只读' }}</small>
            </button>
          </div>

          <div class="nginx-workbar-actions">
            <span v-if="selectedConfigFile" class="nginx-active-file-path" :title="selectedConfigFile.containerPath">
              {{ selectedConfigFile.containerPath }}
            </span>
            <button
              class="secondary-button"
              type="button"
              :disabled="isLoading"
              @click="loadNginxConfigInfo"
            >
              {{ isLoading ? '检测中...' : '重新检测' }}
            </button>
          </div>
        </section>

        <p v-if="loadError" class="container-state failed">{{ loadError }}</p>
        <p v-else-if="isLoading" class="container-state">正在读取 docker inspect、分析挂载路径并加载 Nginx 配置...</p>
        <p v-else-if="connectionHint" class="container-state">{{ connectionHint }}</p>
        <p v-else-if="configLoadError" class="container-state failed">{{ configLoadError }}</p>

        <section v-if="!isLoading && !loadError && selectedConfigAnalysis" class="nginx-service-dashboard">
          <header class="nginx-dashboard-head">
            <div class="nginx-dashboard-copy">
              <h3>服务映射</h3>
              <small>按项目聚合前端入口与后端接口，点击服务查看完整规则</small>
            </div>
            <div class="nginx-overview-metrics">
              <span><strong>{{ selectedRouteOverview.services }}</strong> 服务</span>
              <span><strong>{{ selectedRouteOverview.frontend }}</strong> 前端入口</span>
              <span><strong>{{ selectedRouteOverview.backend }}</strong> 后端接口</span>
              <span v-if="selectedRouteOverview.system"><strong>{{ selectedRouteOverview.system }}</strong> 系统规则</span>
            </div>
          </header>

          <div v-if="serviceCards.length" class="nginx-service-grid">
            <button
              v-for="service in serviceCards"
              :key="service.id"
              class="nginx-service-card"
              :class="[service.statusTone, { https: service.hasHttps }]"
              type="button"
              @click="openServiceDetail(service)"
            >
              <header class="nginx-service-card-head">
                <div>
                  <span>{{ service.alias }}</span>
                  <h4>{{ service.name }}</h4>
                  <small :title="service.domainLabel">{{ service.domainLabel }}</small>
                </div>
                <b>{{ service.frontend.length + service.backend.length }}</b>
              </header>

              <div class="nginx-service-route-groups">
                <section class="nginx-service-route-group frontend">
                  <header>
                    <span>前端入口</span>
                    <strong>{{ service.frontend.length || '未配置' }}</strong>
                  </header>
                  <ul>
                    <li
                      v-for="route in routePreview(service.frontend, '未配置前端入口')"
                      :key="route.id"
                      :class="{ muted: route.muted }"
                    >
                      <strong>{{ route.path }}</strong>
                      <small v-if="route.title && !route.muted">{{ route.title }}</small>
                    </li>
                  </ul>
                </section>

                <section class="nginx-service-route-group backend">
                  <header>
                    <span>后端接口</span>
                    <strong>{{ service.backend.length || '未配置' }}</strong>
                  </header>
                  <ul>
                    <li
                      v-for="route in routePreview(service.backend, '未配置后端接口')"
                      :key="route.id"
                      :class="{ muted: route.muted }"
                    >
                      <strong>{{ route.path }}</strong>
                      <small v-if="!route.muted" :title="route.targetLabel">{{ route.targetLabel }}</small>
                    </li>
                  </ul>
                </section>
              </div>

              <footer class="nginx-service-card-foot">
                <span :class="service.statusTone">{{ service.statusLabel }}</span>
                <span v-if="service.hasHttps">HTTPS</span>
                <span :title="service.listenLabel">{{ service.listenLabel }}</span>
              </footer>
            </button>
          </div>

          <section v-else class="nginx-empty-state compact">
            <strong>没有可归类的前后端路由</strong>
            <p>当前配置文件里没有识别到 root、alias、try_files 或 proxy_pass 类型的 location。</p>
          </section>

          <section v-if="systemRules.length" class="nginx-system-rules">
            <header>
              <div>
                <p class="eyebrow">System Rules</p>
                <h4>跳转与其他规则</h4>
              </div>
              <b>{{ systemRules.length }}</b>
            </header>
            <div>
              <span
                v-for="rule in systemRules"
                :key="rule.id"
                :class="rule.tone"
                :title="`${rule.scope} · ${rule.detail}`"
              >
                <strong>{{ rule.title }}</strong>
                {{ rule.scope }}
              </span>
            </div>
          </section>
        </section>

        <section v-if="!isLoading && !loadError && !selectedConfigAnalysis && mountRows.length" class="nginx-mount-map">
          <header class="nginx-mount-map-header">
            <div>
              <p class="eyebrow">Mount Map</p>
              <h3>挂载分布</h3>
            </div>
            <div class="nginx-mount-map-summary">
              <span><strong>{{ mountOverview.static }}</strong> 前端</span>
              <span><strong>{{ mountOverview.config }}</strong> 后端配置</span>
              <span><strong>{{ mountOverview.other }}</strong> 其他</span>
            </div>
          </header>

          <div class="nginx-mount-groups">
            <section
              v-for="section in groupedMountSections"
              :key="section.key"
              class="nginx-mount-group"
              :class="section.key"
            >
              <header class="nginx-mount-group-head">
                <div>
                  <span>{{ section.eyebrow }}</span>
                  <strong>{{ section.title }}</strong>
                  <small>{{ section.description }}</small>
                </div>
                <b>{{ section.rows.length }}</b>
              </header>

              <div v-if="section.rows.length" class="nginx-mount-card-grid">
                <article
                  v-for="row in section.rows"
                  :key="row.id"
                  class="nginx-mount-card"
                  :class="[section.key, mountCardState(row)]"
                >
                  <header class="nginx-mount-card-head">
                    <div>
                      <span>{{ mountGroupLabel(row) }}</span>
                      <strong>{{ row.role }}</strong>
                    </div>
                    <b>{{ mountCardStateLabel(row) }}</b>
                  </header>

                  <dl class="nginx-mount-card-paths">
                    <div>
                      <dt>宿主机</dt>
                      <dd :title="row.source">{{ row.source || '-' }}</dd>
                      <small>{{ mountTypeLabel(row.type) }} · {{ pathTypeLabel(row.sourceType) }}</small>
                    </div>
                    <div>
                      <dt>容器内</dt>
                      <dd :title="row.destination">{{ row.destination || '-' }}</dd>
                      <small>{{ pathTypeLabel(row.destinationType) }}</small>
                    </div>
                  </dl>

                  <footer class="nginx-mount-card-foot">
                    <span>{{ editabilityLabel(row) }}</span>
                    <span>{{ row.mode }}</span>
                    <span>{{ row.propagation }}</span>
                  </footer>
                </article>
              </div>

              <p v-else class="nginx-mount-group-empty">{{ section.emptyText }}</p>
            </section>
          </div>
        </section>

        <section v-else-if="!isLoading && !loadError && !selectedConfigAnalysis" class="nginx-empty-state">
          <strong>未检测到 Nginx 配置挂载</strong>
          <p>当前容器没有命中 /etc/nginx、/etc/nginx/conf.d、nginx.conf 或 /usr/share/nginx/html 的挂载路径。</p>
        </section>
      </div>
    </section>

    <div
      v-if="detailService"
      class="nginx-detail-overlay"
      role="presentation"
      @click.self="closeServiceDetail"
    >
      <aside
        class="nginx-detail-panel"
        role="dialog"
        aria-modal="true"
        :aria-label="`${detailService.name} 路由详情`"
      >
        <header class="nginx-detail-head">
          <div>
            <p class="eyebrow">Service Detail</p>
            <h3>{{ detailService.name }}</h3>
            <small>{{ detailService.domainLabel }} · {{ detailService.listenLabel }}</small>
          </div>
          <button class="nginx-detail-close" type="button" aria-label="关闭详情" @click="closeServiceDetail">
            ×
          </button>
        </header>

        <div class="nginx-detail-overview">
          <div>
            <span>{{ detailService.alias }}</span>
            <strong>{{ detailService.frontend.length + detailService.backend.length }} 条路由规则</strong>
            <small>匹配依据：{{ detailService.matchLabel }}</small>
          </div>
          <div class="nginx-detail-summary">
            <span :class="detailService.statusTone">{{ detailService.statusLabel }}</span>
            <span>{{ detailService.frontend.length }} 前端入口</span>
            <span>{{ detailService.backend.length }} 后端接口</span>
            <span v-if="detailService.hasHttps">HTTPS</span>
          </div>
        </div>

        <div class="nginx-detail-columns">
          <section class="nginx-detail-section frontend" :class="{ empty: !detailService.frontend.length }">
            <header>
              <div>
                <span>Frontend</span>
                <strong>前端入口</strong>
              </div>
              <b>{{ detailService.frontend.length }}</b>
            </header>

            <div v-if="detailService.frontend.length" class="nginx-detail-route-list">
              <article
                v-for="route in detailService.frontend"
                :key="route.id"
                class="nginx-detail-route"
              >
                <header>
                  <strong>{{ route.path }}</strong>
                  <span>{{ route.kindLabel }}</span>
                </header>
                <dl>
                  <div>
                    <dt>目标目录</dt>
                    <dd :title="route.targetLabel">{{ route.targetLabel }}</dd>
                  </div>
                  <div>
                    <dt>回退规则</dt>
                    <dd :title="route.fallbackLabel">{{ route.fallbackLabel }}</dd>
                  </div>
                  <div>
                    <dt>来源</dt>
                    <dd :title="route.sourceLabel">{{ route.sourceLabel }}</dd>
                  </div>
                  <div>
                    <dt>归类</dt>
                    <dd :title="route.matchReason">{{ route.matchReason }}</dd>
                  </div>
                </dl>
              </article>
            </div>
            <p v-else class="nginx-detail-empty">未配置前端入口</p>
          </section>

          <section class="nginx-detail-section backend" :class="{ empty: !detailService.backend.length }">
            <header>
              <div>
                <span>Backend</span>
                <strong>后端接口</strong>
              </div>
              <b>{{ detailService.backend.length }}</b>
            </header>

            <div v-if="detailService.backend.length" class="nginx-detail-route-list">
              <article
                v-for="route in detailService.backend"
                :key="route.id"
                class="nginx-detail-route"
              >
                <header>
                  <strong>{{ route.path }}</strong>
                  <span>{{ route.kindLabel }}</span>
                </header>
                <dl>
                  <div>
                    <dt>代理到</dt>
                    <dd :title="route.targetLabel">{{ route.targetLabel }}</dd>
                  </div>
                  <div>
                    <dt>监听</dt>
                    <dd :title="route.listenLabel">{{ route.listenLabel }}</dd>
                  </div>
                  <div>
                    <dt>来源</dt>
                    <dd :title="route.sourceLabel">{{ route.sourceLabel }}</dd>
                  </div>
                  <div>
                    <dt>归类</dt>
                    <dd :title="route.matchReason">{{ route.matchReason }}</dd>
                  </div>
                </dl>
              </article>
            </div>
            <p v-else class="nginx-detail-empty">未配置后端接口</p>
          </section>
        </div>
      </aside>
    </div>
  </div>
</template>
