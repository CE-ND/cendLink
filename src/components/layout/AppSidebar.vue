<script setup>
import { useRoute, useRouter } from 'vue-router'

// 侧边栏是渲染进程工作区页面的统一导航入口。
defineProps({
  // 当前表单中的服务器名称，用于没有保存记录时的默认展示。
  serverName: {
    type: String,
    default: '',
  },
  // 当前表单中的 Host，用于没有保存记录时的默认展示。
  serverHost: {
    type: String,
    default: '',
  },
  // 已保存服务器列表。
  servers: {
    type: Array,
    default: () => [],
  },
  // 当前选中的服务器 id，用于高亮侧边栏记录。
  activeServerId: {
    type: String,
    default: '',
  },
  // 当前被设为默认启动目标的服务器 id。
  pinnedServerId: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['selectServer', 'pinServer', 'createServer'])

const route = useRoute()
const router = useRouter()

// 左侧主导航。routeName 对应 src/router/index.js 中的路由 name。
const navigationItems = [
  { routeName: 'servers', label: '服务器' },
  { routeName: 'package', label: '镜像打包' },
  { routeName: 'deploy', label: '远程部署' },
  { routeName: 'frontend', label: '前端上传' },
  { routeName: 'containers', label: '容器日志' },
  { routeName: 'commands', label: '命令' },
  { routeName: 'history', label: '部署记录' },
  { routeName: 'settings', label: '设置' },
]

/**
 * 切换工作区页面。
 */
function navigate(routeName) {
  if (route.name === routeName) {
    return
  }

  router.push({ name: routeName })
}

/**
 * 打开服务器页并进入新建服务器模式。
 */
function createServer() {
  emit('createServer')

  if (route.name !== 'servers') {
    router.push({ name: 'servers' })
  }
}
</script>

<template>
  <aside class="sidebar">
    <div>
      <p class="eyebrow">CendLink</p>
      <h1>远程连接</h1>
    </div>

    <nav class="nav-list" aria-label="主导航">
      <button
        v-for="item in navigationItems"
        :key="item.routeName"
        class="nav-item"
        :class="{ active: route.name === item.routeName }"
        type="button"
        @click="navigate(item.routeName)"
      >
        {{ item.label }}
      </button>
    </nav>

    <section class="server-list" aria-label="已保存服务器">
      <div class="server-list-header">
        <p class="server-list-title">已保存服务器</p>
        <button class="server-new-button" type="button" @click="createServer">新建</button>
      </div>

      <div
        v-for="server in servers"
        :key="server.id"
        class="server-row"
        :class="{ selected: activeServerId === server.id }"
      >
        <button
          class="server-row-main server-row-button"
          :class="{ selected: activeServerId === server.id }"
          type="button"
          @click="emit('selectServer', server.id)"
        >
          <span
            class="status-dot"
            :class="{
              connected: server.lastStatus === 'connected',
              failed: server.lastStatus === 'failed',
            }"
          ></span>
          <div class="server-row-copy">
            <div class="server-row-title">
              <strong>{{ server.name }}</strong>
              <span v-if="pinnedServerId === server.id" class="server-tag">默认</span>
            </div>
            <small>{{ server.host }}:{{ server.port }}</small>
          </div>
        </button>

        <button
          type="button"
          class="server-pin-button"
          :class="{ active: pinnedServerId === server.id }"
          :aria-pressed="pinnedServerId === server.id"
          @click.stop="emit('pinServer', server.id)"
        >
          {{ pinnedServerId === server.id ? '取消置顶' : '置顶' }}
        </button>
      </div>

      <div v-if="!servers.length" class="server-row server-row-empty">
        <span class="status-dot"></span>
        <div class="server-row-copy">
          <strong>{{ serverName || '默认服务器' }}</strong>
          <small>{{ serverHost || '等待填写 Host' }}</small>
        </div>
      </div>
    </section>
  </aside>
</template>
