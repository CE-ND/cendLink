import { readonly, ref } from 'vue'

// 主题（浅色/深色）全局状态。设计为单例：模块级 ref 让侧边栏、设置弹窗、终端共享同一份。
// 持久化双写：localStorage 供首帧防闪脚本同步读取；Electron settings（DB）供跨机/长期保存。
const STORAGE_KEY = 'cendlink.theme'
const VALID = new Set(['light', 'dark'])

// 首帧 index.html 内联脚本已把 data-theme 写到 <html>，这里以它为准初始化，避免二次闪烁。
function readInitialTheme() {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (VALID.has(attr)) {
      return attr
    }
  }
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (VALID.has(stored)) {
      return stored
    }
  }
  return 'light'
}

const theme = ref(readInitialTheme())

function applyToDom(value) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', value)
  }
}

function persistLocal(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // 隐私模式或存储不可用时忽略：DOM 与 DB 仍会生效。
  }
}

async function persistRemote(value) {
  const bridge = globalThis.window?.cendlink?.settings
  if (!bridge?.set) {
    return
  }
  try {
    await bridge.set('theme', value)
  } catch {
    // 浏览器预览模式无 Electron 桥接，仅靠 localStorage 持久化。
  }
}

// 设置主题并落地到 DOM + 两处持久化。silent=true 用于「从 DB 校准本地」时不再回写 DB。
function setTheme(value, { silent = false } = {}) {
  const next = VALID.has(value) ? value : 'light'
  theme.value = next
  applyToDom(next)
  persistLocal(next)
  if (!silent) {
    void persistRemote(next)
  }
}

function toggleTheme() {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}

export function useTheme() {
  return {
    theme: readonly(theme),
    isDark: () => theme.value === 'dark',
    setTheme,
    toggleTheme,
    STORAGE_KEY,
  }
}
