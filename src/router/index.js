import { createRouter, createWebHashHistory } from 'vue-router'
import CommandsView from '../features/commands/views/CommandsView.vue'
import ServersView from '../features/connections/views/ServersView.vue'
import ImagePackageView from '../features/docker/views/ImagePackageView.vue'
import DeployHistoryView from '../features/history/views/DeployHistoryView.vue'
import SettingsView from '../features/settings/views/SettingsView.vue'
import AppShell from '../layouts/AppShell.vue'

// 应用使用 hash 路由，适合 Electron 打包后直接加载本地 index.html。
const routes = [
  {
    path: '/',
    // AppShell 负责侧边栏、头部和底部日志；子路由只切换中间内容区。
    component: AppShell,
    redirect: { name: 'servers' },
    children: [
      {
        path: 'servers',
        name: 'servers',
        component: ServersView,
        meta: {
          eyebrow: 'SSH Connection',
          title: '连接测试',
        },
      },
      {
        path: 'package',
        name: 'package',
        component: ImagePackageView,
        meta: {
          eyebrow: 'Docker Package',
          title: '镜像打包',
        },
      },
      {
        path: 'commands',
        name: 'commands',
        component: CommandsView,
        meta: {
          eyebrow: 'Remote Command',
          title: '命令执行',
        },
      },
      {
        path: 'history',
        name: 'history',
        component: DeployHistoryView,
        meta: {
          eyebrow: 'Deploy History',
          title: '部署记录',
        },
      },
      {
        path: 'settings',
        name: 'settings',
        component: SettingsView,
        meta: {
          eyebrow: 'Workspace Settings',
          title: '设置',
        },
      },
    ],
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
