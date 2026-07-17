<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from '../components/layout/AppSidebar.vue'
import SettingsModal from '../features/settings/components/SettingsModal.vue'
import TerminalOutput from '../components/terminal/TerminalOutput.vue'
import { useWorkspaceSession } from '../features/workspace/composables/useWorkspaceSession.js'
import { useTheme } from '../composables/useTheme.js'

// 共享壳层负责固定布局框架，路由页面只在内容区域切换。
const route = useRoute()
const terminalRef = ref(null)
const isWindowMaximized = ref(false)
// 设置模态框开关，由侧边栏左下角入口触发。
const isSettingsOpen = ref(false)
let removeWindowStateListener = null

// 从共享会话取出跨页面需要的状态和动作。
const {
  form,
  logs,
  hasElectronBridge,
  savedServers,
  activeServerId,
  pinnedServerId,
  loadStoredData,
  createNewServer,
  pinServer,
  selectSavedServer,
} = useWorkspaceSession()

// 主题状态：首帧已由 index.html 内联脚本 + localStorage 定好，这里挂载后再从 DB 校准一次。
const { theme, toggleTheme, setTheme } = useTheme()

// 当前页面头部的小标题和标题，来自路由 meta。
const pageEyebrow = computed(() => route.meta.eyebrow || 'Workspace')
const pageTitle = computed(() => route.meta.title || '远程工作区')
const isTerminalHiddenRoute = computed(() => (
  ['servers', 'package', 'deploy', 'frontend', 'files', 'containers', 'nginx-config', 'commands', 'history'].includes(route.name)
))
const isImmersiveWorkspaceRoute = computed(() => route.name === 'files')
// 判断 preload 桥是否可用，用于提示当前是 Electron 模式还是浏览器预览。
const bridgeStatusText = computed(() => {
  return hasElectronBridge.value ? 'Electron 已连接' : '浏览器预览'
})
const hasWindowControls = computed(() => Boolean(getWindowControls()))

function getWindowControls() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.cendlink?.windowControls || null
}

function openLogTerminal() {
  terminalRef.value?.openExpanded()
}

function minimizeWindow() {
  getWindowControls()?.minimize()
}

function toggleMaximizeWindow() {
  getWindowControls()?.toggleMaximize()
}

function closeWindow() {
  getWindowControls()?.close()
}

// 从 DB 读取权威主题值校准本地；仅当与当前（localStorage 猜测）不一致时才更新，silent 避免回写 DB。
async function calibrateThemeFromDb() {
  const bridge = window.cendlink?.settings
  if (!bridge?.get) {
    return
  }

  try {
    const stored = await bridge.get('theme', theme.value)
    if ((stored === 'light' || stored === 'dark') && stored !== theme.value) {
      setTheme(stored, { silent: true })
    }
  } catch {
    // 读取失败时维持首帧主题，不影响使用。
  }
}

// 应用壳挂载后读取本地数据库内容。
onMounted(() => {
  loadStoredData()
  calibrateThemeFromDb()

  const windowControls = getWindowControls()

  if (!windowControls) {
    return
  }

  const maximizedState = windowControls.isMaximized?.()

  maximizedState?.then((value) => {
    isWindowMaximized.value = Boolean(value)
  })

  removeWindowStateListener = windowControls.onMaximizedChange?.((value) => {
    isWindowMaximized.value = Boolean(value)
  })
})

onBeforeUnmount(() => {
  removeWindowStateListener?.()
})
</script>

<template>
  <main class="connection-page">
    <header class="app-titlebar">
      <div class="app-titlebar-brand">CendLink</div>
      <div class="app-titlebar-spacer"></div>
      <div v-if="hasWindowControls" class="window-controls" aria-label="窗口控制">
        <button class="window-control" type="button" aria-label="最小化" @click="minimizeWindow">
          <span class="window-icon minimize" aria-hidden="true"></span>
        </button>
        <button
          class="window-control"
          type="button"
          :aria-label="isWindowMaximized ? '还原' : '最大化'"
          @click="toggleMaximizeWindow"
        >
          <span
            class="window-icon"
            :class="isWindowMaximized ? 'restore' : 'maximize'"
            aria-hidden="true"
          ></span>
        </button>
        <button class="window-control close" type="button" aria-label="关闭" @click="closeWindow">
          <span class="window-icon close" aria-hidden="true"></span>
        </button>
      </div>
    </header>

    <AppSidebar
      :server-name="form.name"
      :server-host="form.host"
      :servers="savedServers"
      :active-server-id="activeServerId"
      :pinned-server-id="pinnedServerId"
      :theme="theme"
      @create-server="createNewServer"
      @pin-server="pinServer"
      @select-server="selectSavedServer"
      @open-settings="isSettingsOpen = true"
      @toggle-theme="toggleTheme"
    />

    <div class="app-page-frame">
      <section
        class="workspace"
        :class="{
          'workspace-terminal-hidden': isTerminalHiddenRoute,
          'workspace-immersive': isImmersiveWorkspaceRoute,
        }"
      >
        <header v-if="!isImmersiveWorkspaceRoute" class="workspace-header">
          <div>
            <p class="eyebrow">{{ pageEyebrow }}</p>
            <h2>{{ pageTitle }}</h2>
          </div>
          <span class="bridge-badge" :class="{ ready: hasElectronBridge }">
            {{ bridgeStatusText }}
          </span>
        </header>

        <div class="workspace-content">
          <RouterView v-slot="{ Component }">
            <component :is="Component" @open-logs="openLogTerminal" />
          </RouterView>
        </div>

        <TerminalOutput ref="terminalRef" :lines="logs" :inline="!isTerminalHiddenRoute" />
      </section>
    </div>

    <SettingsModal :open="isSettingsOpen" @close="isSettingsOpen = false" />
  </main>
</template>
