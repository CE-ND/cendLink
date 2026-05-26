<script setup>
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from '../components/layout/AppSidebar.vue'
import TerminalOutput from '../components/terminal/TerminalOutput.vue'
import { useWorkspaceSession } from '../features/workspace/composables/useWorkspaceSession.js'

// 共享壳层负责固定布局框架，路由页面只在内容区域切换。
const route = useRoute()
const { form, logs, hasElectronBridge } = useWorkspaceSession()

const pageEyebrow = computed(() => route.meta.eyebrow || 'Workspace')
const pageTitle = computed(() => route.meta.title || '远程工作区')
const bridgeStatusText = computed(() => {
  return hasElectronBridge.value ? 'Electron 已连接' : '浏览器预览'
})
</script>

<template>
  <main class="connection-page">
    <AppSidebar :server-name="form.name" :server-host="form.host" />

    <section class="workspace">
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
        <RouterView />
      </div>

      <TerminalOutput :lines="logs" />
    </section>
  </main>
</template>
