<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'
import { useTheme } from '../../../composables/useTheme.js'

// 命令页的核心：一个基于 client.shell() 的真·交互式终端。
// 连接成功后自动开启伪终端，键盘输入直达远端，输出实时回显，cd/环境在会话内保持。
const { form, result, needsRetest, hasElectronBridge, isTesting } = useWorkspaceSession()

const router = useRouter()

const terminalHost = ref(null)
// 当前终端会话 id；为空表示没有活跃会话。
const sessionId = ref('')
// 终端状态机：idle/connecting/ready/error/exit/closed。
const status = ref('idle')
const statusMessage = ref('')

// 非响应式的 xterm 实例与插件，不放进 ref，避免被 Vue 代理。
let term = null
let fitAddon = null
let resizeObserver = null
let unsubscribe = null
let lastCols = 0
let lastRows = 0
// 组件是否仍在挂载中。用于处理「开会话的 await 期间用户切走页面」的竞态。
let active = true
// 是否正在开启会话。防止 await 未返回前被再次触发而开出重复的后端会话。
let opening = false

// 浅色终端主题，色板对齐应用的设计 token（accent 青、success 绿、danger 红）。
const LIGHT_THEME = {
  background: '#f7f9fa',
  foreground: '#33383e',
  cursor: '#0e9aa1',
  cursorAccent: '#f7f9fa',
  selectionBackground: 'rgba(16, 156, 163, 0.20)',
  selectionForeground: '#1f242a',
  black: '#3a4046',
  red: '#cf4a3a',
  green: '#1f9e5f',
  yellow: '#b07d16',
  blue: '#2f6fb0',
  magenta: '#9152c4',
  cyan: '#0e9aa1',
  white: '#c4cace',
  brightBlack: '#6b747c',
  brightRed: '#e05c49',
  brightGreen: '#23b06c',
  brightYellow: '#c8922a',
  brightBlue: '#3f7ec2',
  brightMagenta: '#a468d6',
  brightCyan: '#1ab3bb',
  brightWhite: '#eef1f3',
}

// 深色终端主题：背景对齐 --terminal-stage 暗色值，色板整体提亮以在深底上保持对比。
const DARK_THEME = {
  background: '#22262c',
  foreground: '#d3d8dd',
  cursor: '#25c2ca',
  cursorAccent: '#22262c',
  selectionBackground: 'rgba(37, 194, 202, 0.28)',
  selectionForeground: '#eef1f3',
  black: '#2a2f35',
  red: '#e0685a',
  green: '#54c98a',
  yellow: '#d3a54a',
  blue: '#5f97d6',
  magenta: '#b585e0',
  cyan: '#25c2ca',
  white: '#c4cace',
  brightBlack: '#7b848c',
  brightRed: '#ec8172',
  brightGreen: '#6ed7a0',
  brightYellow: '#e0b866',
  brightBlue: '#78a9e2',
  brightMagenta: '#c79bef',
  brightCyan: '#43d6de',
  brightWhite: '#f4f6f8',
}

const { theme } = useTheme()

function currentTerminalTheme() {
  return theme.value === 'dark' ? DARK_THEME : LIGHT_THEME
}

// 帮助气泡里的常用命令，点击即写入终端执行。
const quickCommands = [
  { cmd: 'docker ps', desc: '运行中的容器' },
  { cmd: 'docker ps -a', desc: '全部容器' },
  { cmd: 'docker images', desc: '镜像列表' },
  { cmd: 'docker stats --no-stream', desc: '资源快照' },
  { cmd: 'df -h', desc: '磁盘使用' },
  { cmd: 'free -h', desc: '内存使用' },
  { cmd: 'systemctl status docker', desc: 'Docker 服务状态' },
]

// 帮助气泡里的键盘快捷键，仅作参考。
const shortcuts = [
  { keys: 'Ctrl + C', desc: '中断当前命令' },
  { keys: 'Tab', desc: '路径 / 命令补全' },
  { keys: 'Ctrl + L', desc: '清屏' },
  { keys: '↑ / ↓', desc: '历史命令' },
  { keys: 'exit', desc: '结束会话' },
]

// 允许开终端的前置条件：Electron 桥接可用、连接测试成功、配置未变更。
const canUseTerminal = computed(() => {
  return Boolean(hasElectronBridge.value && result.value?.ok && !needsRetest.value)
})

const statusMeta = computed(() => {
  switch (status.value) {
    case 'connecting':
      return { tone: 'pending', text: '连接中' }
    case 'ready':
      return { tone: 'ok', text: '已连接' }
    case 'error':
      return { tone: 'danger', text: '连接失败' }
    case 'exit':
      return { tone: 'danger', text: '已断开' }
    case 'closed':
      return { tone: 'idle', text: '已关闭' }
    default:
      return { tone: 'idle', text: '未连接' }
  }
})

const targetLabel = computed(() => {
  if (!result.value?.ok) {
    return ''
  }

  return `${form.username}@${form.host}:${form.port}`
})

const overlayText = computed(() => {
  if (!hasElectronBridge.value) {
    return '请通过 Electron 模式启动应用后再使用终端'
  }

  if (isTesting.value) {
    return '连接测试进行中，请稍候…'
  }

  if (needsRetest.value) {
    return '服务器连接信息已变更，请重新测试连接'
  }

  if (!result.value?.ok) {
    return '请先在「服务器」页测试连接，成功后自动进入终端'
  }

  return ''
})

// 会话已结束但仍处于已连接状态时，允许一键重连。
const showReconnect = computed(() => {
  return canUseTerminal.value && !sessionId.value && ['error', 'exit', 'closed'].includes(status.value)
})

function getSshBridge() {
  return globalThis.window?.cendlink?.ssh ?? null
}

/**
 * 打开一个新的终端会话。
 */
async function openTerminalSession() {
  if (!term || sessionId.value || opening) {
    return
  }

  const ssh = getSshBridge()

  if (!ssh?.openShell) {
    status.value = 'error'
    statusMessage.value = '当前不是 Electron 环境，无法开启终端'
    return
  }

  opening = true
  status.value = 'connecting'
  statusMessage.value = '正在连接…'
  term.clear()

  try {
    fitAddon?.fit()
  } catch {
    // 容器尺寸暂不可用时忽略，后续 ResizeObserver 会再校正。
  }

  lastCols = term.cols
  lastRows = term.rows

  try {
    const response = await ssh.openShell({ ...form }, { cols: term.cols, rows: term.rows })

    // await 期间组件可能已卸载：此时后端会话已建立，必须主动关闭，否则会泄漏。
    if (!active || !term) {
      if (response?.ok && response.id) {
        ssh.closeShell(response.id)
      }
      return
    }

    if (!response?.ok) {
      status.value = 'error'
      statusMessage.value = response?.message || '终端连接失败'
      term.writeln(`\r\n\x1b[31m● ${statusMessage.value}\x1b[0m`)
      return
    }

    sessionId.value = response.id
    term.focus()
  } catch (error) {
    if (!active) {
      return
    }

    status.value = 'error'
    statusMessage.value = error?.message || String(error)
  } finally {
    opening = false
  }
}

/**
 * 关闭当前终端会话。
 */
function closeTerminalSession() {
  const ssh = getSshBridge()

  if (sessionId.value && ssh?.closeShell) {
    ssh.closeShell(sessionId.value)
  }

  sessionId.value = ''
}

/**
 * 处理来自主进程的终端事件。只响应当前会话 id 的事件。
 */
function handleShellEvent(payload) {
  if (!payload || payload.id !== sessionId.value) {
    return
  }

  switch (payload.type) {
    case 'connecting':
      status.value = 'connecting'
      statusMessage.value = payload.message || ''
      break
    case 'ready':
      status.value = 'ready'
      statusMessage.value = ''
      break
    case 'data':
      term?.write(payload.chunk)
      break
    case 'error':
      status.value = 'error'
      statusMessage.value = payload.message || '终端连接出错'
      term?.writeln(`\r\n\x1b[31m● ${statusMessage.value}\x1b[0m`)
      sessionId.value = ''
      break
    case 'exit':
      status.value = 'exit'
      statusMessage.value = payload.message || '终端会话已结束'
      term?.writeln(`\r\n\x1b[90m● ${statusMessage.value}\x1b[0m`)
      sessionId.value = ''
      break
    case 'closed':
      status.value = 'closed'
      sessionId.value = ''
      break
    default:
      break
  }
}

/**
 * 容器尺寸变化时重新适配终端，并同步窗口大小到远端 pty。
 */
function handleResize() {
  if (!fitAddon || !term) {
    return
  }

  try {
    fitAddon.fit()
  } catch {
    return
  }

  const ssh = getSshBridge()

  if (sessionId.value && ssh?.resizeShell && (term.cols !== lastCols || term.rows !== lastRows)) {
    lastCols = term.cols
    lastRows = term.rows
    ssh.resizeShell(sessionId.value, { cols: term.cols, rows: term.rows })
  }
}

function clearTerminal() {
  term?.clear()
  term?.focus()
}

/**
 * 点击帮助气泡里的常用命令：写入当前会话并回车执行。
 */
function runQuickCommand(command) {
  const ssh = getSshBridge()

  if (!sessionId.value || !ssh?.writeShell) {
    return
  }

  ssh.writeShell(sessionId.value, `${command}\n`)
  term?.focus()
}

function goServers() {
  router.push({ name: 'servers' })
}

onMounted(() => {
  term = new Terminal({
    theme: currentTerminalTheme(),
    fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'SFMono-Regular', ui-monospace, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 3000,
    convertEol: false,
  })
  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(terminalHost.value)

  try {
    fitAddon.fit()
  } catch {
    // 首帧容器尺寸暂不可用时忽略，ResizeObserver 会随后校正。
  }

  // 键盘输入直达远端 pty。
  term.onData((data) => {
    const ssh = getSshBridge()

    if (sessionId.value && ssh?.writeShell) {
      ssh.writeShell(sessionId.value, data)
    }
  })

  unsubscribe = getSshBridge()?.onShellEvent?.(handleShellEvent) || null

  resizeObserver = new ResizeObserver(() => handleResize())
  resizeObserver.observe(terminalHost.value)

  if (canUseTerminal.value) {
    openTerminalSession()
  }
})

onBeforeUnmount(() => {
  active = false
  closeTerminalSession()
  unsubscribe?.()
  unsubscribe = null
  resizeObserver?.disconnect()
  resizeObserver = null
  term?.dispose()
  term = null
  fitAddon = null
})

// 连接态变化时联动终端：接入即开，断开即关。
watch(canUseTerminal, (usable) => {
  if (usable && !sessionId.value) {
    openTerminalSession()
  } else if (!usable && sessionId.value) {
    closeTerminalSession()
    term?.clear()
    status.value = 'idle'
    statusMessage.value = ''
  }
})

// 主题切换时给已开终端换色，保持与应用整体一致。
watch(theme, () => {
  if (term) {
    term.options.theme = currentTerminalTheme()
  }
})
</script>

<template>
  <section class="ssh-terminal">
    <header class="terminal-topbar">
      <div class="terminal-identity">
        <span class="terminal-status-dot" :class="statusMeta.tone"></span>
        <span v-if="targetLabel" class="terminal-target">{{ targetLabel }}</span>
        <span v-else class="terminal-target muted">未连接服务器</span>

        <div class="terminal-help">
          <button class="terminal-help-trigger" type="button" aria-label="常用命令与快捷键">?</button>
          <div class="terminal-help-popover" role="tooltip">
            <div class="help-section">
              <p class="help-section-title">
                常用命令
                <span>点击直接执行</span>
              </p>
              <button
                v-for="item in quickCommands"
                :key="item.cmd"
                type="button"
                class="help-cmd"
                @click="runQuickCommand(item.cmd)"
              >
                <code>{{ item.cmd }}</code>
                <span>{{ item.desc }}</span>
              </button>
            </div>

            <div class="help-section">
              <p class="help-section-title">快捷键</p>
              <div v-for="item in shortcuts" :key="item.keys" class="help-shortcut">
                <kbd>{{ item.keys }}</kbd>
                <span>{{ item.desc }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="terminal-tools">
        <span class="terminal-state-text">{{ statusMeta.text }}</span>
        <button v-if="showReconnect" type="button" class="terminal-tool-button" @click="openTerminalSession">
          重新连接
        </button>
        <button type="button" class="terminal-tool-button" @click="clearTerminal">清屏</button>
      </div>
    </header>

    <div class="terminal-stage">
      <div ref="terminalHost" class="terminal-host"></div>

      <div v-if="!canUseTerminal" class="terminal-overlay">
        <p class="terminal-overlay-text">{{ overlayText }}</p>
        <button
          v-if="hasElectronBridge && !result?.ok && !isTesting"
          type="button"
          class="terminal-overlay-button"
          @click="goServers"
        >
          去连接服务器
        </button>
      </div>

      <div
        v-else-if="status === 'connecting'"
        class="terminal-overlay terminal-overlay-connecting"
      >
        <span class="terminal-connecting-dot" aria-hidden="true"></span>
        <p class="terminal-overlay-text">正在连接 {{ targetLabel }}…</p>
      </div>
    </div>
  </section>
</template>
