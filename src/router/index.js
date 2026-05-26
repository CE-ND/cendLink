import { createRouter, createWebHashHistory } from 'vue-router'
import CommandsView from '../features/commands/views/CommandsView.vue'
import ServersView from '../features/connections/views/ServersView.vue'
import DeployHistoryView from '../features/history/views/DeployHistoryView.vue'
import SettingsView from '../features/settings/views/SettingsView.vue'
import AppShell from '../layouts/AppShell.vue'

const routes = [
  {
    path: '/',
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
