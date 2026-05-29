<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from '../components/layout/AppSidebar.vue'
import TerminalOutput from '../components/terminal/TerminalOutput.vue'
import { useWorkspaceSession } from '../features/workspace/composables/useWorkspaceSession.js'

// 共享壳层负责固定布局框架，路由页面只在内容区域切换。
const route = useRoute()
const terminalRef = ref(null)

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
const isTerminalHiddenRoute = computed(() => ['package', 'deploy', 'settings', 'containers'].includes(route.name))
// 判断 preload 桥是否可用，用于提示当前是 Electron 模式还是浏览器预览。
const bridgeStatusText = computed(() => {
  return hasElectronBridge.value ? 'Electron 已连接' : '浏览器预览'
})

function openLogTerminal() {
  terminalRef.value?.openExpanded()
}

// 应用壳挂载后读取本地数据库内容。
onMounted(() => {
  loadStoredData()
})
</script>

<template>
  <main class="connection-page">
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
  </main>
</template>
