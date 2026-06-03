<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from '../components/layout/AppSidebar.vue'
import TerminalOutput from '../components/terminal/TerminalOutput.vue'
import { useWorkspaceSession } from '../features/workspace/composables/useWorkspaceSession.js'

// 共享壳层负责固定布局框架，路由页面只在内容区域切换。
const route = useRoute()
const terminalRef = ref(null)
const isWindowMaximized = ref(false)
const appLogoUrl = `${import.meta.env.BASE_URL || './'}Cend.svg`
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

// 当前页面头部的小标题和标题，来自路由 meta。
const pageEyebrow = computed(() => route.meta.eyebrow || 'Workspace')
const pageTitle = computed(() => route.meta.title || '远程工作区')
const isTerminalHiddenRoute = computed(() => ['package', 'deploy', 'frontend', 'settings', 'containers'].includes(route.name))
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

// 应用壳挂载后读取本地数据库内容。
onMounted(() => {
  loadStoredData()

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
      <div class="app-titlebar-brand">
        <img class="app-titlebar-logo" :src="appLogoUrl" alt="" aria-hidden="true" />
        <span>CendLink</span>
      </div>
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
      @create-server="createNewServer"
      @pin-server="pinServer"
      @select-server="selectSavedServer"
    />

    <div class="app-page-frame">
      <section class="workspace" :class="{ 'workspace-terminal-hidden': isTerminalHiddenRoute }">
        <header class="workspace-header">
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
  </main>
</template>
