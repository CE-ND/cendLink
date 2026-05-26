<script setup>
import { useRoute, useRouter } from 'vue-router'

// 侧边栏是渲染进程工作区页面的统一导航入口。
defineProps({
  serverName: {
    type: String,
    default: '',
  },
  serverHost: {
    type: String,
    default: '',
  },
})

const route = useRoute()
const router = useRouter()

const navigationItems = [
  { routeName: 'servers', label: '服务器' },
  { routeName: 'commands', label: '命令' },
  { routeName: 'history', label: '部署记录' },
  { routeName: 'settings', label: '设置' },
]

function navigate(routeName) {
  if (route.name === routeName) {
    return
  }

  router.push({ name: routeName })
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

    <section class="server-list" aria-label="当前服务器">
      <div class="server-row selected">
        <span class="status-dot"></span>
        <div>
          <strong>{{ serverName || '默认服务器' }}</strong>
          <small>{{ serverHost || '等待填写 Host' }}</small>
        </div>
      </div>
    </section>
  </aside>
</template>
