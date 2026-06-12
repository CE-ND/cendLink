<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'
import AppSelect from '../../../components/ui/AppSelect.vue'

const CONTAINER_LIST_COMMAND =
  "docker ps -a --format '{{.ID}}|||{{.Names}}|||{{.Image}}|||{{.Status}}|||{{.Ports}}|||{{.CreatedAt}}'"
const MAX_LOG_LINES = 5000
const logTailOptions = [
  { value: 100, label: '100' },
  { value: 300, label: '300' },
  { value: 1000, label: '1000' },
]

const {
  form,
  result,
  needsRetest,
  hasElectronBridge,
  workspaceSettings,
} = useWorkspaceSession()

const containers = ref([])
const selectedContainerId = ref('')
const searchText = ref('')
const logTail = ref(300)
const logOutput = ref('')
const listError = ref('')
const logError = ref('')
const streamStatus = ref('')
const isLoadingContainers = ref(false)
const isLoadingLogs = ref(false)
const isFollowing = ref(false)
const isAutoScrollPaused = ref(false)
const followSessionId = ref('')
const openActionMenuId = ref('')
const logBodyRef = ref(null)
const router = useRouter()

let unsubscribeStream = null

const canQueryDocker = computed(() => {
  return Boolean(hasElectronBridge.value && result.value?.ok && !needsRetest.value)
})

const connectionHint = computed(() => {
  if (!hasElectronBridge.value) {
    return '请通过 Electron 模式启动应用后再查看容器。'
  }

  if (!result.value?.ok) {
    return '请先在服务器页完成连接测试。'
  }

  if (needsRetest.value) {
    return '服务器连接信息已变更，请重新测试连接。'
  }

  return ''
})

const filteredContainers = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()

  if (!keyword) {
    return containers.value
  }

  return containers.value.filter((container) => {
    return [container.id, container.name, container.image, container.status, container.ports]
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  })
})

const selectedContainer = computed(() => {
  return containers.value.find((container) => container.id === selectedContainerId.value) || null
})

const runningCount = computed(() => {
  return containers.value.filter((container) => isRunning(container.status)).length
})

const logPlaceholder = computed(() => {
  if (!selectedContainer.value) {
    return '选择一个容器查看日志'
  }

  if (isLoadingLogs.value) {
    return '正在读取日志...'
  }

  if (!logOutput.value && !logError.value) {
    return '该容器暂无日志输出'
  }

  return ''
})

const displayLogLines = computed(() => {
  const output = logOutput.value || logPlaceholder.value

  return String(output || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line, index) => formatLogLine(line, index))
})

onMounted(() => {
  void refreshContainers()
})

onBeforeUnmount(() => {
  void stopFollowing({ silent: true })
})

async function refreshContainers() {
  if (!canQueryDocker.value) {
    listError.value = connectionHint.value
    return
  }

  isLoadingContainers.value = true
  listError.value = ''

  try {
    const response = await executeDockerCommand(CONTAINER_LIST_COMMAND)

    if (!response.ok) {
      throw new Error(response.message || response.stderr || '读取容器列表失败')
    }

    containers.value = parseContainerRows(response.stdout)

    if (selectedContainerId.value && !containers.value.some((item) => item.id === selectedContainerId.value)) {
      selectedContainerId.value = ''
      logOutput.value = ''
    }

    if (openActionMenuId.value && !containers.value.some((item) => item.id === openActionMenuId.value)) {
      openActionMenuId.value = ''
    }
  } catch (error) {
    listError.value = error?.message || String(error)
  } finally {
    isLoadingContainers.value = false
  }
}

async function selectContainer(container) {
  openActionMenuId.value = ''
  selectedContainerId.value = container.id
  isAutoScrollPaused.value = false
  await loadContainerLogs(container)
}

function toggleContainerActionMenu(containerId) {
  openActionMenuId.value = openActionMenuId.value === containerId ? '' : containerId
}

async function openNginxConfig(container) {
  if (!isNginxContainer(container)) {
    return
  }

  await stopFollowing({ silent: true })
  openActionMenuId.value = ''
  selectedContainerId.value = container.id
  isAutoScrollPaused.value = false

  router.push({
    name: 'nginx-config',
    params: {
      containerId: container.id,
    },
    query: {
      name: container.name,
      image: container.image,
      status: container.status,
      ports: container.ports,
    },
  })
}

async function loadContainerLogs(container = selectedContainer.value) {
  if (!container || !canQueryDocker.value) {
    logError.value = connectionHint.value
    return
  }

  await stopFollowing({ silent: true })
  isLoadingLogs.value = true
  logError.value = ''
  streamStatus.value = ''
  logOutput.value = ''
  isAutoScrollPaused.value = false

  try {
    const response = await executeDockerCommand(buildDockerLogsCommand(container, false))

    if (selectedContainerId.value !== container.id) {
      return
    }

    logOutput.value = mergeCommandOutput(response)

    if (!response.ok) {
      logError.value = response.message || '读取日志失败'
    }

    await scrollLogToBottom()
  } catch (error) {
    logError.value = error?.message || String(error)
  } finally {
    isLoadingLogs.value = false
  }
}

async function toggleFollowing() {
  if (isFollowing.value) {
    await stopFollowing()
    return
  }

  await startFollowing()
}

async function startFollowing() {
  const container = selectedContainer.value
  const ssh = getSshBridge()

  if (!container || !canQueryDocker.value) {
    logError.value = connectionHint.value
    return
  }

  if (!hasLogStreamBridge(ssh)) {
    logError.value = '当前 Electron 主进程还没有流式日志能力，请重启桌面窗口后再试。'
    return
  }

  await stopFollowing({ silent: true })
  logError.value = ''
  streamStatus.value = '正在启动日志跟随...'
  logOutput.value = ''
  isAutoScrollPaused.value = false
  isFollowing.value = true

  unsubscribeStream = ssh.onCommandStreamEvent(handleStreamEvent)

  try {
    const response = await ssh.startCommandStream({ ...form }, buildDockerLogsCommand(container, true))

    if (!response.ok) {
      throw new Error(response.message || '启动日志跟随失败')
    }

    followSessionId.value = response.id
  } catch (error) {
    cleanupStreamListener()
    isFollowing.value = false
    followSessionId.value = ''
    streamStatus.value = ''
    logError.value = formatStreamError(error)
  }
}

async function stopFollowing(options = {}) {
  const sessionId = followSessionId.value
  const ssh = getSshBridge()

  cleanupStreamListener()
  followSessionId.value = ''

  if (!sessionId) {
    isFollowing.value = false
    return
  }

  try {
    await ssh?.stopCommandStream?.(sessionId)
  } catch {
    // 停止失败时仍然清理前端状态，避免界面卡在跟随中。
  }

  isFollowing.value = false

  if (!options.silent) {
    streamStatus.value = '已停止跟随日志'
  }
}

function handleStreamEvent(event) {
  if (!event?.id || event.id !== followSessionId.value) {
    return
  }

  if (event.type === 'stdout' || event.type === 'stderr') {
    appendLogChunk(event.chunk)
    return
  }

  if (event.type === 'connecting' || event.type === 'started') {
    streamStatus.value = event.message || ''
    return
  }

  if (event.type === 'error') {
    logError.value = event.message || '日志跟随失败'
    isFollowing.value = false
    followSessionId.value = ''
    cleanupStreamListener()
    return
  }

  if (event.type === 'close' || event.type === 'stopped') {
    streamStatus.value = event.message || '日志跟随已结束'
    isFollowing.value = false
    followSessionId.value = ''
    cleanupStreamListener()
  }
}

function parseContainerRows(output) {
  return String(output || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id = '', name = '', image = '', status = '', ports = '', createdAt = ''] = line.split('|||')

      return {
        id,
        name,
        image,
        status,
        ports,
        createdAt,
      }
    })
    .filter((container) => container.id && container.name)
    .sort(compareContainers)
}

async function executeDockerCommand(command) {
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

function buildDockerLogsCommand(container, follow) {
  const followFlag = follow ? ' -f' : ''

  return `docker logs${followFlag} --tail ${Number(logTail.value || 300)} --timestamps ${shellQuote(container.id)}`
}

function mergeCommandOutput(response) {
  return [response.stdout, response.stderr]
    .map((value) => String(value || '').trimEnd())
    .filter(Boolean)
    .join('\n')
}

function appendLogChunk(chunk) {
  if (!chunk) {
    return
  }

  logOutput.value += chunk

  const lines = logOutput.value.replace(/\r\n/g, '\n').split('\n')

  if (lines.length > MAX_LOG_LINES) {
    logOutput.value = lines.slice(-MAX_LOG_LINES).join('\n')
  }

  if (!isAutoScrollPaused.value) {
    void scrollLogToBottom()
  }
}

async function scrollLogToBottom() {
  await nextTick()

  if (logBodyRef.value) {
    logBodyRef.value.scrollTop = logBodyRef.value.scrollHeight
  }
}

async function goLogBottom() {
  isAutoScrollPaused.value = false
  await scrollLogToBottom()
}

function handleLogScroll() {
  const target = logBodyRef.value

  if (!target || !isFollowing.value) {
    return
  }

  const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight
  isAutoScrollPaused.value = distanceToBottom > 80
}

function cleanupStreamListener() {
  if (unsubscribeStream) {
    unsubscribeStream()
    unsubscribeStream = null
  }
}

function statusClass(status) {
  if (isRunning(status)) {
    return 'running'
  }

  if (String(status || '').startsWith('Exited')) {
    return 'exited'
  }

  return 'neutral'
}

function statusLabel(status) {
  if (isRunning(status)) {
    return '运行中'
  }

  if (String(status || '').startsWith('Exited')) {
    return '已退出'
  }

  return status || '未知'
}

function formatLogLine(line, index) {
  const rawLine = String(line || '')
  const match = rawLine.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/)
  const text = match ? match[2] : rawLine

  return {
    id: `${index}-${rawLine.slice(0, 18)}`,
    time: match ? match[1] : '',
    text,
    level: getLogLineLevel(rawLine),
  }
}

function getLogLineLevel(line) {
  if (/\b(error|exception|failed|denied|fatal)\b/i.test(line)) {
    return 'error'
  }

  if (/\b(warn|warning)\b/i.test(line)) {
    return 'warn'
  }

  if (/\b(select|insert|update|delete|from|where|preparing|parameters|columns)\b/i.test(line)) {
    return 'sql'
  }

  return 'normal'
}

async function handleTailChange(value) {
  logTail.value = Number(value || 300)

  if (selectedContainer.value && !isFollowing.value) {
    await loadContainerLogs()
  }
}

function compareContainers(left, right) {
  const leftRunning = isRunning(left.status)
  const rightRunning = isRunning(right.status)

  if (leftRunning !== rightRunning) {
    return leftRunning ? -1 : 1
  }

  return left.name.localeCompare(right.name)
}

function isRunning(status) {
  return String(status || '').startsWith('Up')
}

function isNginxContainer(container) {
  const identity = [container?.image, container?.name]
    .map((value) => String(value || '').toLowerCase())
    .join(' ')

  return /(^|[/:@._-])(nginx|openresty)([/:@._-]|$)/i.test(identity) ||
    identity.includes('nginxinc') ||
    identity.includes('nginx-proxy')
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

function hasLogStreamBridge(ssh) {
  return Boolean(ssh?.startCommandStream && ssh?.stopCommandStream && ssh?.onCommandStreamEvent)
}

function formatStreamError(error) {
  const message = error?.message || String(error)

  if (
    message.includes('No handler registered') ||
    message.includes('ssh:start-command-stream')
  ) {
    return '当前桌面主进程还没有注册日志跟随通道，请完全关闭 CendLink 后重新运行 npm run dev:electron。'
  }

  return message
}
</script>

<template>
  <div class="container-logs-view">
    <section class="container-list-pane">
      <header class="container-pane-header">
        <div>
          <strong>容器</strong>
          <small>{{ containers.length }} 个 / {{ runningCount }} 运行中</small>
        </div>
        <button class="secondary-button" type="button" :disabled="isLoadingContainers" @click="refreshContainers">
          {{ isLoadingContainers ? '刷新中...' : '刷新' }}
        </button>
      </header>

      <div class="container-search-row">
        <input
          v-model="searchText"
          type="search"
          placeholder="搜索容器、镜像或端口"
        />
      </div>

      <p v-if="listError" class="container-state failed">{{ listError }}</p>
      <p v-else-if="isLoadingContainers" class="container-state">正在读取容器列表...</p>
      <p v-else-if="!filteredContainers.length" class="container-state">暂无匹配容器</p>

      <div class="container-list">
        <div
          v-for="container in filteredContainers"
          :key="container.id"
          class="container-row"
          :class="{ active: selectedContainerId === container.id, nginx: isNginxContainer(container) }"
        >
          <button
            class="container-row-select"
            type="button"
            @click="selectContainer(container)"
          >
            <span class="container-row-main">
              <strong :title="container.name">{{ container.name }}</strong>
              <span v-if="isNginxContainer(container)" class="container-kind-badge">Nginx</span>
              <span class="container-uptime">{{ container.status }}</span>
            </span>
            <span class="container-row-image" :title="container.image">{{ container.image }}</span>
            <small>{{ container.ports || '未暴露端口' }}</small>
            <span class="container-row-state">
              <span class="container-status-dot" :class="statusClass(container.status)"></span>
              <span>{{ statusLabel(container.status) }}</span>
            </span>
          </button>

          <span class="container-row-actions">
            <button
              v-if="isNginxContainer(container)"
              class="container-action-trigger"
              type="button"
              :class="{ open: openActionMenuId === container.id }"
              :aria-expanded="openActionMenuId === container.id"
              aria-label="容器操作"
              title="容器操作"
              @click.stop="toggleContainerActionMenu(container.id)"
            >
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
            </button>

            <Transition name="container-action-menu-transition">
              <span
                v-if="openActionMenuId === container.id"
                class="container-action-menu"
                @click.stop
              >
                <button type="button" @click="openNginxConfig(container)">
                  更改配置
                </button>
              </span>
            </Transition>
          </span>
        </div>
      </div>
    </section>

    <section class="container-log-pane">
      <header class="container-pane-header log-pane-header">
        <div>
          <strong>{{ selectedContainer?.name || '容器日志' }}</strong>
          <small>
            {{
              selectedContainer
                ? `${selectedContainer.image} · ${selectedContainer.ports || '未暴露端口'}`
                : '选择左侧容器后查看日志'
            }}
          </small>
        </div>
        <span v-if="selectedContainer" class="container-log-status">
          <span class="container-status-dot" :class="statusClass(selectedContainer.status)"></span>
          {{ isFollowing ? '实时跟随中' : statusLabel(selectedContainer.status) }}
        </span>
      </header>

      <div class="container-log-toolbar">
        <label class="log-tail-select">
          <span>行数</span>
          <AppSelect
            :model-value="logTail"
            :options="logTailOptions"
            :disabled="isFollowing"
            @change="handleTailChange"
          />
        </label>

        <button
          v-if="isAutoScrollPaused"
          class="secondary-button"
          type="button"
          @click="goLogBottom"
        >
          回到底部
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="!selectedContainer || isLoadingLogs || isFollowing"
          @click="loadContainerLogs()"
        >
          刷新日志
        </button>
        <button
          class="primary-button"
          type="button"
          :class="{ danger: isFollowing }"
          :disabled="!selectedContainer || isLoadingLogs"
          @click="toggleFollowing"
        >
          {{ isFollowing ? '停止' : '跟随' }}
        </button>
      </div>

      <p v-if="streamStatus" class="container-state">{{ streamStatus }}</p>
      <p v-if="logError" class="container-state failed">{{ logError }}</p>

      <div ref="logBodyRef" class="container-log-output" @scroll="handleLogScroll">
        <div
          v-for="line in displayLogLines"
          :key="line.id"
          class="container-log-line"
          :class="line.level"
        >
          <span class="container-log-time">{{ line.time }}</span>
          <span class="container-log-text">{{ line.text || ' ' }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
